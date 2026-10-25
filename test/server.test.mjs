import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setImmediate as flush } from 'node:timers/promises';
import { createServer } from '../server.mjs';
import { createTwitchBridge, isTwitchReconnectUrl } from '../lib/twitch.mjs';

async function start(t, options = {}) {
  const server = createServer({ twitchOptions: { clientId: '', accessToken: '' }, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, { token, body, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
    const response = await fetch(base + path, { method, headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  const created = await call('/api/rooms', { body: {} });
  assert.equal(created.status, 201);
  return { server, base, call, ...created.body };
}

test('host, public overlay, and crew receive correctly isolated projections', async (t) => {
  const { call, roomId, hostToken } = await start(t);
  const host = await call(`/api/rooms/${roomId}/state`, { token: hostToken });
  assert.equal(host.body.roomId, roomId);
  assert.equal(host.body.dossier, undefined);
  assert.equal(host.body.secretSeed, undefined);
  assert.equal(host.body.puzzles, undefined);
  const cipher = await call(`/api/rooms/${roomId}/join`, { body: { name: 'Cipher user', role: 'cipher' } });
  const architect = await call(`/api/rooms/${roomId}/join`, { body: { name: 'Architect user', role: 'architect' } });
  assert.equal(cipher.status, 200);
  assert.equal(cipher.body.state.dossier.role, 'cipher');
  assert.equal(architect.body.state.dossier.role, 'architect');
  assert.notDeepEqual(cipher.body.state.dossier.clues, architect.body.state.dossier.clues);
  const publicView = await call(`/api/rooms/${roomId}/state`);
  assert.equal(publicView.body.dossier, undefined);
  assert.equal(JSON.stringify(publicView.body).includes(cipher.body.viewerToken), false);
  assert.equal(JSON.stringify(publicView.body).includes(hostToken), false);
  const stolenRole = await call(`/api/rooms/${roomId}/state?role=architect`, { token: cipher.body.viewerToken });
  assert.equal(stolenRole.body.dossier.role, 'cipher');
});

test('only a host can change mission state; viewers can transmit and vote', async (t) => {
  const { call, roomId, hostToken } = await start(t);
  const path = `/api/rooms/${roomId}`;
  const joined = await call(`${path}/join`, { body: { name: 'Echo', role: 'cipher' } });
  const viewerToken = joined.body.viewerToken;
  assert.equal((await call(`${path}/action`, { token: viewerToken, body: { action: 'start' } })).status, 403);
  assert.equal((await call(`${path}/action`, { body: { action: 'start' } })).status, 403);
  assert.equal((await call(`${path}/action`, { token: hostToken, body: { action: 'start' } })).body.phase, 'active');
  assert.equal((await call(`${path}/chat`, { token: hostToken, body: { text: 'host bypass' } })).status, 403);
  const message = await call(`${path}/chat`, { token: viewerToken, body: { text: 'My clue is ready.' } });
  assert.equal(message.status, 200);
  assert.ok(message.body.comms.some((entry) => entry.text === 'My clue is ready.' && entry.source === 'crew'));
  const demo = await call(`${path}/demo`, { token: hostToken, body: { role: 'architect' } });
  assert.equal(demo.status, 200);
  assert.ok(demo.body.comms.some((entry) => entry.source === 'demo' && entry.role === 'architect'));
  assert.equal(demo.body.dossier, undefined);
});

test('SSE immediately streams the authorized projection and follows host actions', async (t) => {
  const { call, base, roomId, hostToken } = await start(t);
  const joined = await call(`/api/rooms/${roomId}/join`, { body: { name: 'Ghost', role: 'lookout' } });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/api/rooms/${roomId}/events?token=${joined.body.viewerToken}`, { signal: controller.signal });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /"dossier":\{"role":"lookout"/);
  assert.doesNotMatch(first, /secretSeed|hostToken|viewerToken/);
  await call(`/api/rooms/${roomId}/action`, { token: hostToken, body: { action: 'start' } });
  const next = new TextDecoder().decode((await reader.read()).value);
  assert.match(next, /"phase":"active"/);
  await reader.cancel();
});

test('rejects cross-site writes, malformed auth, missing rooms, and invalid input', async (t) => {
  const { call, roomId, hostToken } = await start(t);
  const path = `/api/rooms/${roomId}`;
  assert.equal((await call(`${path}/action`, { token: hostToken, body: { action: 'start' }, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call(`${path}/state`, { token: 'é'.repeat(43) })).status, 401);
  assert.equal((await call('/api/rooms/000000/state')).status, 404);
  assert.equal((await call(`${path}/join`, { body: { name: 'Ghost', role: 'host' } })).status, 400);
  assert.equal((await call('/api/rooms', { body: { durationSeconds: -1 } })).status, 400);
  assert.equal((await call(`${path}/demo`, { body: { role: 'cipher' } })).status, 403);
  assert.equal((await call(`${path}/twitch`, { token: hostToken, body: { action: 'connect' } })).status, 409);
  const config = await call(`${path}/twitch`, { token: hostToken });
  assert.deepEqual(config.body, { configured: false, connected: false, status: 'disconnected', channel: null });
});

test('room expiration removes host and viewer sessions; capacity is bounded', async (t) => {
  let clock = Date.now();
  const { call, roomId, hostToken } = await start(t, { now: () => clock, maxRooms: 1, maxPlayers: 1 });
  assert.equal((await call('/api/rooms', { body: {} })).status, 503);
  assert.equal((await call(`/api/rooms/${roomId}/join`, { body: { name: 'One' } })).status, 200);
  assert.equal((await call(`/api/rooms/${roomId}/join`, { body: { name: 'Two' } })).status, 409);
  clock += 6 * 60 * 60 * 1000 + 1;
  assert.equal((await call(`/api/rooms/${roomId}/state`, { token: hostToken })).status, 404);
  assert.equal((await call('/api/rooms', { body: {} })).status, 201);
});

test('only public assets are served; application deep links use the browser entry point', async (t) => {
  const { base, roomId } = await start(t);
  for (const path of ['/.env', '/server.mjs', '/lib/engine.mjs', '/%2e%2e/package.json']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  // Root owns frontend files and may still be writing them during parallel build.
  const root = await fetch(base + '/');
  if (root.status === 200) {
    const deep = await fetch(`${base}/crew/${roomId}`);
    assert.equal(deep.status, 200);
    assert.equal(await deep.text(), await root.text());
  }
});

class FakeSocket extends EventTarget {
  static instances = [];
  constructor(url) {
    super(); this.url = url; this.closed = false; FakeSocket.instances.push(this);
    queueMicrotask(() => this.message({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: `session-${FakeSocket.instances.length}`, keepalive_timeout_seconds: 30 } } }));
  }
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  close() { this.closed = true; this.dispatchEvent(new Event('close')); }
}

function twitchFixture() {
  FakeSocket.instances = [];
  const requests = [];
  const messages = [];
  const bridge = createTwitchBridge({ clientId: 'client', accessToken: 'server-secret', WebSocketImpl: FakeSocket,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/validate')) return Response.json({ client_id: 'client', user_id: '123', login: 'broadcaster', scopes: ['user:read:chat'] });
      return Response.json({ data: [{ id: 'subscription' }] }, { status: 202 });
    },
    onMessage: (message) => { messages.push(message); return { replies: [] }; },
  });
  return { bridge, requests, messages };
}

test('Twitch bridge validates identity, subscribes as broadcaster, deduplicates, and migrates without resubscribing', async (t) => {
  const { bridge, requests, messages } = twitchFixture();
  t.after(() => bridge.disconnect());
  assert.equal(bridge.getStatus().connected, false);
  await bridge.connect(); await flush();
  assert.deepEqual(bridge.getStatus(), { configured: true, connected: true, status: 'connected', channel: 'broadcaster' });
  const subscription = requests.find((request) => request.url.includes('eventsub/subscriptions'));
  assert.deepEqual(JSON.parse(subscription.options.body).condition, { broadcaster_user_id: '123', user_id: '123' });
  assert.equal(subscription.options.headers.Authorization, 'Bearer server-secret');
  assert.equal(JSON.stringify(bridge.getStatus()).includes('server-secret'), false);
  const first = FakeSocket.instances[0];
  const notification = { metadata: { message_type: 'notification', subscription_type: 'channel.chat.message', message_id: 'unique' }, payload: { event: { broadcaster_user_id: '123', chatter_user_id: '999', chatter_user_name: 'Ghost', message: { text: '!clue' } } } };
  first.message(notification); first.message(notification); await flush();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].source, 'twitch');
  first.message({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?session=migration' } } });
  await flush();
  assert.equal(FakeSocket.instances.length, 2);
  assert.equal(first.closed, true);
  assert.equal(requests.filter((request) => request.url.includes('eventsub/subscriptions')).length, 1);
  assert.equal(bridge.getStatus().connected, true);
});

test('Twitch rejects unsafe reconnect addresses and invalid scope before going live', async (t) => {
  assert.equal(isTwitchReconnectUrl('wss://eventsub.wss.twitch.tv/ws?session=abc'), true);
  for (const url of ['wss://evil.example/ws', 'https://eventsub.wss.twitch.tv/ws', 'wss://eventsub.wss.twitch.tv:444/ws', 'wss://user@eventsub.wss.twitch.tv/ws']) assert.equal(isTwitchReconnectUrl(url), false);
  const { bridge } = twitchFixture();
  t.after(() => bridge.disconnect());
  await bridge.connect(); await flush();
  FakeSocket.instances[0].message({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://evil.example/ws' } } });
  assert.equal(bridge.getStatus().connected, false);
  assert.match(bridge.getStatus().status, /unexpected reconnect/);
  const invalid = createTwitchBridge({ clientId: 'client', accessToken: 'secret', fetchImpl: async () => Response.json({ client_id: 'client', user_id: '123', login: 'streamer', scopes: [] }), WebSocketImpl: FakeSocket });
  await assert.rejects(invalid.connect(), /user:read:chat/);
  assert.equal(invalid.getStatus().connected, false);
  invalid.disconnect();
});

test('Twitch chat reaches the mission with a stable specialist role and sends the matching clue reply', async (t) => {
  FakeSocket.instances = [];
  const outgoing = [];
  const { call, roomId, hostToken } = await start(t, { twitchOptions: {
    clientId: 'client', accessToken: 'server-secret', WebSocketImpl: FakeSocket,
    fetchImpl: async (url, options) => {
      if (url.endsWith('/validate')) return Response.json({ client_id: 'client', user_id: '123', login: 'broadcaster', scopes: ['user:read:chat', 'user:write:chat'] });
      if (url.endsWith('/chat/messages')) outgoing.push(JSON.parse(options.body));
      return Response.json({ data: [] }, { status: 202 });
    },
  } });
  const connected = await call(`/api/rooms/${roomId}/twitch`, { token: hostToken, body: { action: 'connect' } });
  assert.equal(connected.status, 200);
  await flush();
  const ws = FakeSocket.instances[0];
  ws.message({ metadata: { message_type: 'notification', subscription_type: 'channel.chat.message', message_id: 'clue-event' }, payload: { event: {
    broadcaster_user_id: '123', chatter_user_id: '999', chatter_user_name: 'Nightowl', message: { text: '!clue' },
  } } });
  await flush();
  const state = (await call(`/api/rooms/${roomId}/state`)).body;
  const member = state.members.find((item) => item.id === 'twitch:999');
  assert.ok(member);
  assert.equal(member.role, 'cipher');
  const clue = state.comms.find((item) => item.name === 'Nightowl' && item.source === 'twitch');
  assert.equal(clue.role, 'cipher');
  assert.match(clue.text, / = /);
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].broadcaster_id, '123');
  assert.equal(outgoing[0].sender_id, '123');
  assert.ok(outgoing[0].message.includes(clue.text));
  const current = (await call(`/api/rooms/${roomId}/twitch`, { token: hostToken })).body;
  assert.equal(current.connected, true);
  assert.equal(current.channel, 'broadcaster');
});
