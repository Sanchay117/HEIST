import test from 'node:test';
import assert from 'node:assert/strict';
import { createPairingStore, PAIRING_TTL_MS } from '../lib/pairing.mjs';
import { startTwitchFixture } from './support/twitch-fixture.mjs';

async function fixture(t) { const f = await startTwitchFixture(); t.after(() => f.close()); return f; }
const state = async (f, room, token) => (await f.call(`${room.path}/state`, { token })).body;
async function issue(f, room, token) {
  const response = await f.call(`${room.path}/pairing`, { token, body: {} });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return { token: response.body.viewerToken, code: response.body.state.pairing.code, state: response.body.state };
}
async function link(f, room, browser, userId, name) {
  await f.send(userId, `!link ${browser.code}`, name);
  const pending = await state(f, room, browser.token);
  assert.equal(pending.pairing.status, 'confirm');
  assert.equal(pending.dossier, undefined, 'Claiming alone cannot reveal clues');
  const response = await f.call(`${room.path}/pairing`, { token: browser.token, body: { action: 'confirm', claimId: pending.pairing.claimId } });
  assert.equal(response.status, 200);
  return response.body;
}

test('live rejects anonymous joins, pre-link votes, claims without browser confirmation, and demo bypasses', async t => {
  const f = await fixture(t), room = await f.create();
  assert.equal((await f.call(`${room.path}/join`, { body: { name: 'Nightowl', role: 'lookout' } })).status, 403);
  assert.equal((await f.call(`${room.path}/demo`, { token: room.hostToken, body: { role: 'cipher' } })).status, 403);
  assert.equal((await f.call(`${room.path}/pairing`, { body: {} })).status, 409);
  await f.connect(room);
  const browser = await issue(f, room);
  assert.equal(browser.state.dossier, undefined);
  assert.equal(browser.state.crew.total, 0);
  await f.call(`${room.path}/action`, { token: room.hostToken, body: { action: 'start' } });
  for (const token of [undefined, browser.token]) assert.equal((await f.call(`${room.path}/chat`, { token, body: { text: '!vote 1234' } })).status, 403);
  await f.send('999', `!link ${browser.code}`, 'Nightowl');
  assert.equal((await f.call(`${room.path}/chat`, { token: browser.token, body: { text: '!vote 1234' } })).status, 403);
  const publicView = await state(f, room);
  assert.deepEqual(publicView.votes, []);
  assert.equal(publicView.pairing, undefined);
  assert.equal(JSON.stringify(publicView).includes(browser.code), false);
  assert.equal(JSON.stringify(publicView).includes('!link'), false);
  assert.equal(JSON.stringify(publicView).includes(browser.token), false);
  assert.equal((await f.call(`${room.path}/pairing`, { token: browser.token, body: { action: 'confirm', claimId: 'forged' } })).status, 409);
});

for (const order of ['chat-first', 'companion-first']) test(`${order}: shared Twitch identity keeps role and cross-interface last vote`, async t => {
  const f = await fixture(t), room = await f.create(); await f.connect(room);
  if (order === 'chat-first') await f.send('999', '!heist', 'Nightowl');
  const browser = await issue(f, room);
  const linked = await link(f, room, browser, '999', 'Nightowl');
  if (order === 'companion-first') await f.send('999', '!heist', 'Nightowl');
  assert.equal(linked.identity.id, 'twitch:999');
  assert.equal(linked.dossier.role, 'cipher');
  assert.equal((await state(f, room)).crew.total, 1);
  await f.call(`${room.path}/action`, { token: room.hostToken, body: { action: 'start' } });
  await f.send('999', '!vote 1234', 'Nightowl');
  assert.equal((await state(f, room, browser.token)).identity.vote, '1234');
  await f.call(`${room.path}/chat`, { token: browser.token, body: { text: '!vote 5678' } });
  assert.deepEqual((await state(f, room)).votes, [{ optionId: '5678', count: 1 }]);
  await f.send('999', '!vote 4321', 'Nightowl');
  assert.deepEqual((await state(f, room)).votes, [{ optionId: '4321', count: 1 }]);
  assert.equal((await state(f, room, browser.token)).dossier.role, 'cipher');
});

test('multiple browsers share one account, role, vote, and dynamically upgraded SSE session', async t => {
  const f = await fixture(t), room = await f.create(); await f.connect(room);
  const one = await issue(f, room), two = await issue(f, room);
  assert.notEqual(one.code, two.code);
  const controller = new AbortController(); t.after(() => controller.abort());
  const response = await fetch(`${f.base}${room.path}/events?token=${two.token}`, { signal: controller.signal });
  const reader = response.body.getReader(); t.after(() => reader.cancel().catch(() => {}));
  assert.match(new TextDecoder().decode((await reader.read()).value), /"status":"pending"/);
  await link(f, room, one, '999', 'Nightowl');
  const second = await link(f, room, two, '999', 'Nightowl');
  assert.equal(second.crew.total, 1);
  assert.equal(second.identity.id, 'twitch:999');
  assert.equal(second.dossier.role, 'cipher');
  let received = '';
  while (!received.includes('"dossier"')) received += new TextDecoder().decode((await reader.read()).value);
  assert.match(received, /"verified":true/);
  assert.equal(JSON.stringify(await state(f, room)).includes(two.code), false);
  await f.call(`${room.path}/action`, { token: room.hostToken, body: { action: 'start' } });
  await f.call(`${room.path}/chat`, { token: one.token, body: { text: '!vote 1234' } });
  await f.call(`${room.path}/chat`, { token: two.token, body: { text: '!vote 5678' } });
  assert.deepEqual((await state(f, room)).votes, [{ optionId: '5678', count: 1 }]);
  assert.equal((await state(f, room, one.token)).identity.vote, '5678');
  await reader.cancel();
});

test('consumed codes and linked sessions cannot be overwritten by another Twitch account', async t => {
  const f = await fixture(t), room = await f.create(); await f.connect(room);
  const browser = await issue(f, room);
  await f.send('999', `!link ${browser.code}`, 'Nightowl');
  const claim = (await state(f, room, browser.token)).pairing;
  await f.send('888', `!link ${browser.code}`, 'OtherViewer');
  assert.deepEqual((await state(f, room, browser.token)).pairing, claim);
  await f.call(`${room.path}/pairing`, { token: browser.token, body: { action: 'confirm', claimId: claim.claimId } });
  assert.equal((await f.call(`${room.path}/pairing`, { token: browser.token, body: {} })).status, 409);
  await f.send('888', `!link ${browser.code}`, 'OtherViewer');
  assert.equal((await state(f, room, browser.token)).identity.id, 'twitch:999');
  assert.equal((await f.call(`${room.path}/pairing`, { token: browser.token, body: { action: 'confirm', claimId: claim.claimId } })).status, 409);
});

test('expired codes, expired confirmations, regeneration, and mission reset invalidate old claims', async t => {
  const f = await fixture(t), room = await f.create(); await f.connect(room);
  const expired = await issue(f, room); f.advance(PAIRING_TTL_MS);
  await f.send('999', `!link ${expired.code}`);
  assert.equal((await state(f, room, expired.token)).pairing.status, 'expired');
  assert.equal((await state(f, room, expired.token)).dossier, undefined);
  const fresh = await issue(f, room, expired.token);
  await f.send('999', `!link ${expired.code}`);
  assert.equal((await state(f, room, fresh.token)).pairing.status, 'pending');
  await f.send('999', `!link ${fresh.code}`);
  const claim = (await state(f, room, fresh.token)).pairing;
  f.advance(PAIRING_TTL_MS);
  assert.equal((await f.call(`${room.path}/pairing`, { token: fresh.token, body: { action: 'confirm', claimId: claim.claimId } })).status, 409);
  const reset = await issue(f, room, fresh.token);
  await f.call(`${room.path}/action`, { token: room.hostToken, body: { action: 'reset' } });
  await f.send('999', `!link ${reset.code}`);
  assert.equal((await state(f, room, reset.token)).pairing.status, 'expired');
});

test('wrong-mission codes and tokens cannot authenticate another mission', async t => {
  const f = await fixture(t), one = await f.create(), two = await f.create();
  await f.connect(one); const browser = await issue(f, one);
  await f.call(`${one.path}/twitch`, { token: one.hostToken, body: { action: 'disconnect' } });
  await f.connect(two);
  await f.send('999', `!link ${browser.code}`);
  assert.equal((await state(f, two)).crew.total, 0);
  assert.equal((await f.call(`${two.path}/state`, { token: browser.token })).status, 401);
  await f.call(`${two.path}/twitch`, { token: two.hostToken, body: { action: 'disconnect' } });
  await f.connect(one);
  assert.equal((await state(f, one, browser.token)).pairing.status, 'pending');
  assert.equal((await link(f, one, browser, '999')).identity.id, 'twitch:999');
});

test('pairing guesses and code issuance are rate limited; guessing cannot bypass the cooldown', async t => {
  const f = await fixture(t), room = await f.create(); await f.connect(room);
  const browser = await issue(f, room);
  for (let i = 0; i < 5; i++) await f.send('999', '!link INVALID');
  await f.send('999', `!link ${browser.code}`);
  assert.equal((await state(f, room, browser.token)).pairing.status, 'pending');
  f.advance(60_001);
  assert.equal((await link(f, room, browser, '999')).identity.id, 'twitch:999');
  const repeated = await issue(f, room);
  await issue(f, room, repeated.token); await issue(f, room, repeated.token);
  assert.equal((await f.call(`${room.path}/pairing`, { token: repeated.token, body: {} })).status, 429);
});

test('room-wide guessing and per-IP issuance limits also bound multi-account attempts', async t => {
  const f = await fixture(t), room = await f.create(); await f.connect(room);
  const browser = await issue(f, room);
  for (let i = 0; i < 60; i++) await f.send(String(1000 + i), '!link INVALID');
  await f.send('999', `!link ${browser.code}`);
  assert.equal((await state(f, room, browser.token)).pairing.status, 'pending');
  for (let i = 1; i < 20; i++) await issue(f, room);
  assert.equal((await f.call(`${room.path}/pairing`, { body: {} })).status, 429);
});

test('disconnection makes pairing unavailable but preserves verified companion identity and votes', async t => {
  const f = await fixture(t), room = await f.create(); await f.connect(room);
  const linked = await issue(f, room); await link(f, room, linked, '999');
  const pending = await issue(f, room);
  await f.call(`${room.path}/twitch`, { token: room.hostToken, body: { action: 'disconnect' } });
  const waiting = await state(f, room, pending.token);
  assert.equal(waiting.pairing.status, 'unavailable'); assert.equal(waiting.dossier, undefined);
  assert.equal((await f.call(`${room.path}/pairing`, { token: pending.token, body: {} })).status, 409);
  await f.call(`${room.path}/action`, { token: room.hostToken, body: { action: 'start' } });
  assert.equal((await f.call(`${room.path}/chat`, { token: linked.token, body: { text: '!vote 1234' } })).status, 200);
  assert.equal((await state(f, room, linked.token)).identity.verified, true);
  await f.connect(room);
  assert.equal((await state(f, room, pending.token)).pairing.status, 'pending');
});

test('rehearsal preserves anonymous roles, voting, and labeled solo demo; cannot switch modes', async t => {
  const f = await fixture(t), room = await f.create('rehearsal');
  const joined = await f.call(`${room.path}/join`, { body: { name: 'Solo', role: 'lookout' } });
  assert.equal(joined.body.state.dossier.role, 'lookout');
  assert.equal(joined.body.state.identity.verified, false);
  await f.call(`${room.path}/action`, { token: room.hostToken, body: { action: 'start' } });
  assert.equal((await f.call(`${room.path}/chat`, { token: joined.body.viewerToken, body: { text: '!vote 1234' } })).status, 200);
  const demo = await f.call(`${room.path}/demo`, { token: room.hostToken, body: { role: 'cipher' } });
  assert.ok(demo.body.comms.some(message => message.source === 'demo'));
  assert.equal((await f.call(`${room.path}/pairing`, { body: {} })).status, 400);
  assert.equal((await f.call(`${room.path}/twitch`, { token: room.hostToken, body: { action: 'connect' } })).status, 409);
  assert.equal((await f.call(`${room.path}/action`, { token: room.hostToken, body: { action: 'mode', mode: 'live' } })).status, 400);
});

test('codes contain 80 cryptographic random bits and issue independently for separate sessions', () => {
  const store = createPairingStore('ABC123'), issued = new Set();
  for (let i = 0; i < 100; i++) {
    const session = { playerId: null }; store.issue(session, 1_000_000);
    assert.match(session.code, /^ABC123-[A-F0-9]{20}$/);
    assert.equal(session.expiresAt, 1_000_000 + PAIRING_TTL_MS);
    issued.add(session.code);
  }
  assert.equal(issued.size, 100);
});
