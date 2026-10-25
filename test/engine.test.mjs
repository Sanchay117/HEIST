import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, getState, command, chatMessage, tick } from '../lib/engine.mjs';

const beginning = 100000;
const make = (seed = 'test-mission') => createRoom({ id: 'test-room', seed, now: beginning });
const join = (room, role) => joinRoom(room, { id: role, name: `${role} agent`, role }, beginning);
const view = (room, role, now = beginning) => getState(room, { role: 'viewer', playerId: role }, now);
const clue = (room, role, now = beginning) => view(room, role, now).dossier.clues.map(item => item.text).join(' ');

function solveLock(room) {
  const architect = clue(room, 'architect');
  const order = architect.match(/order: (.+)\. This/)[1].split(' → ');
  const fragments = clue(room, 'cipher') + ' ' + clue(room, 'lookout');
  const map = Object.fromEntries([...fragments.matchAll(/(MOON|EYE|CROWN|STAR) = (\d)/g)].map(match => [match[1], match[2]]));
  return order.map(symbol => map[symbol]).join('');
}

function solveWires(room) {
  const terminal = clue(room, 'architect').match(/TERMINAL ([AB])/)[1];
  const pulse = clue(room, 'cipher').match(/an (ODD|EVEN) pulse/)[1];
  const seal = clue(room, 'lookout').match(/a (BROKEN|INTACT) seal/)[1];
  const options = getState(room, {}, beginning).stage.options;
  const matches = options.filter(option => option.detail.includes(`Terminal ${terminal}`) && option.detail.includes(`${pulse} pulse`) && option.detail.includes(`${seal} seal`));
  assert.equal(matches.length, 1);
  for (const omitted of ['terminal', 'pulse', 'seal']) {
    const possible = options.filter(option => (omitted === 'terminal' || option.detail.includes(`Terminal ${terminal}`)) && (omitted === 'pulse' || option.detail.includes(`${pulse} pulse`)) && (omitted === 'seal' || option.detail.includes(`${seal} seal`)));
    assert.ok(possible.length > 1, `The ${omitted} clue must be necessary`);
  }
  return matches[0].id;
}

function solveEscape(room) {
  const ring = clue(room, 'architect').match(/clockwise: (.+) → back/)[1].split(' → ').map(item => item.toLowerCase());
  const slot = Number(clue(room, 'cipher').match(/SLOT (\d)/)[1]);
  const shift = Number(clue(room, 'lookout').match(/FORWARD (\d)/)[1]);
  return ring[(slot - 1 + shift) % 3];
}

test('all seeded missions are solvable from the three role dossiers, without internal answers', () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const room = make(`seed-${seed}`);
    for (const role of ['cipher', 'architect', 'lookout']) join(room, role);
    command(room, 'start', {}, beginning);
    command(room, 'submit', { answer: solveLock(room) }, beginning + 500);
    assert.equal(getState(room, {}, beginning + 500).stage.kind, 'wires');
    command(room, 'submit', { answer: solveWires(room) }, beginning + 1000);
    command(room, 'submit', { answer: solveEscape(room) }, beginning + 1500);
    const state = getState(room, {}, beginning + 1500);
    assert.equal(state.phase, 'escaped');
    assert.equal(state.alarm.value, 0);
    assert.equal(state.result.elapsedSeconds, 1);
  }
});

test('host and public state never expose seeds, solutions, or private dossiers', () => {
  const room = make('redaction-probe');
  join(room, 'cipher');
  for (const role of ['public', 'host']) {
    const state = getState(room, { role }, beginning);
    const json = JSON.stringify(state);
    assert.equal('dossier' in state, false);
    assert.equal('puzzles' in state, false);
    assert.equal('answer' in state.stage, false);
    assert.equal(json.includes('redaction-probe'), false);
    assert.equal(json.includes('fragment A'), false);
    assert.equal(json.includes(room.puzzles[0].answer), false);
  }
  const state = view(room, 'cipher');
  assert.equal(state.dossier.role, 'cipher');
  assert.equal(JSON.stringify(state).includes('Surveillance / fragment B'), false);
  state.dossier.clues[0].text = 'mutated';
  assert.notEqual(clue(room, 'cipher'), 'mutated');
  assert.throws(() => getState(room, { role: 'viewer', playerId: 'absent' }, beginning), { status: 403 });
});

test('the clock uses elapsed wall time, freezes while paused, and expires during a reconnect', () => {
  const room = make();
  command(room, 'start', {}, beginning);
  assert.equal(getState(room, {}, beginning + 12345).clock.remainingSeconds, 468);
  command(room, 'pause', {}, beginning + 12345);
  assert.equal(getState(room, {}, beginning + 1200000).phase, 'active');
  assert.equal(getState(room, {}, beginning + 1200000).clock.remainingSeconds, 468);
  command(room, 'resume', {}, beginning + 1200000);
  assert.equal(getState(room, {}, beginning + 1200001).clock.remainingSeconds, 468);
  assert.equal(tick(room, beginning + 1700000), true);
  const finished = getState(room, {}, beginning + 1700000);
  assert.equal(finished.phase, 'caught');
  assert.equal(finished.clock.remainingSeconds, 0);
  assert.equal(finished.result.elapsedSeconds, 480);
  assert.equal(tick(room, beginning + 1800000), false);
});

test('invalid or out-of-phase actions do not add alarm; three valid wrong attempts cause lockdown', () => {
  const room = make();
  assert.throws(() => command(room, 'submit', { answer: '9999' }, beginning), { status: 409 });
  assert.equal(room.alarm, 0);
  command(room, 'start', {}, beginning);
  assert.throws(() => command(room, 'start', {}, beginning), { status: 409 });
  assert.throws(() => command(room, 'submit', { answer: '12' }, beginning), { status: 400 });
  assert.equal(room.alarm, 0);
  command(room, 'pause', {}, beginning + 10);
  assert.throws(() => command(room, 'submit', { answer: '9999' }, beginning + 20), { status: 409 });
  command(room, 'resume', {}, beginning + 30);
  const wrong = room.puzzles[0].answer === '9999' ? '8888' : '9999';
  for (let index = 0; index < 3; index += 1) command(room, 'submit', { answer: wrong }, beginning + 40 + index);
  assert.equal(room.phase, 'caught');
  assert.equal(room.alarm, 3);
  assert.throws(() => command(room, 'submit', { answer: wrong }, beginning + 50), { status: 409 });
  assert.equal(room.alarm, 3);
});

test('votes are one per player, allow changes, do not solve, and clear on stage transition', () => {
  const room = make();
  for (const role of ['cipher', 'architect', 'lookout']) join(room, role);
  assert.throws(() => chatMessage(room, { id: 'cipher', text: '!vote 1234' }, beginning), { status: 409 });
  command(room, 'start', {}, beginning);
  const send = (id, text, time) => chatMessage(room, { id, text }, beginning + time);
  send('cipher', '!vote 1234', 100);
  send('cipher', '!vote 1234', 1100);
  assert.deepEqual(getState(room, {}, beginning + 1100).votes, [{ optionId: '1234', count: 1 }]);
  send('cipher', '!vote 5678', 1200);
  send('lookout', '!vote 5678', 1300);
  assert.deepEqual(getState(room, {}, beginning + 1300).votes, [{ optionId: '5678', count: 2 }]);
  assert.equal(room.stageIndex, 0);
  command(room, 'submit', { answer: solveLock(room) }, beginning + 1400);
  assert.deepEqual(getState(room, {}, beginning + 1400).votes, []);
  assert.throws(() => send('cipher', '!vote nonexistent', 1500), { status: 400 });
});

test('reset rotates the lock, retains crew, and clears all mission outcomes and old intelligence', () => {
  const room = make();
  join(room, 'cipher');
  const originalCode = room.puzzles[0].answer;
  command(room, 'start', {}, beginning);
  chatMessage(room, { id: 'cipher', text: '!clue', source: 'demo' }, beginning + 1);
  command(room, 'pause', {}, beginning + 10);
  command(room, 'reset', {}, beginning + 20);
  const state = getState(room, {}, beginning + 20);
  assert.notEqual(room.puzzles[0].answer, originalCode);
  assert.equal(state.phase, 'briefing');
  assert.equal(state.crew.total, 1);
  assert.equal(state.paused, false);
  assert.equal(state.clock.remainingSeconds, 480);
  assert.equal(state.comms.length, 0);
  assert.equal(state.events.length, 1);
  assert.equal(state.result, null);
});

test('chat clue sharing is explicit, labelled by its source, role-scoped, and bounded', () => {
  const room = make();
  join(room, 'cipher');
  const response = chatMessage(room, { id: 'cipher', text: '!clue', source: 'demo' }, beginning + 10);
  assert.equal(response.replies.length, 1);
  assert.equal(room.comms[0].source, 'demo');
  assert.equal(room.comms[0].text, clue(room, 'cipher'));
  assert.equal(room.comms[0].role, 'cipher');
  for (let index = 0; index < 100; index += 1) chatMessage(room, { id: 'cipher', text: `Transmission ${index}` }, beginning + 1000 + index);
  assert.equal(room.comms.length, 80);
  assert.equal(room.comms.at(-1).text, 'Transmission 99');
  assert.throws(() => chatMessage(room, { id: 'cipher', text: 'x'.repeat(501) }, beginning), { status: 400 });
  assert.throws(() => chatMessage(room, { id: 'cipher', text: 'hello', source: 'fake' }, beginning), { status: 400 });
});

test('balanced roles, input validation, and independent rooms preserve mission boundaries', () => {
  const first = make();
  const second = make('another');
  const roles = ['one', 'two', 'three', 'four', 'five', 'six'].map(id => joinRoom(first, { id, name: id }, beginning).role);
  assert.deepEqual(roles, ['cipher', 'architect', 'lookout', 'cipher', 'architect', 'lookout']);
  assert.equal(getState(second, {}, beginning).crew.total, 0);
  assert.throws(() => createRoom({ id: 'abc', durationSeconds: 1, now: beginning }), { status: 400 });
  assert.throws(() => joinRoom(first, { id: 'bad', name: 'ok', role: 'host' }, beginning), { status: 400 });
  assert.throws(() => joinRoom(first, { id: 'bad', name: ' ' }, beginning), { status: 400 });
  assert.throws(() => command(first, 'unknown', {}, beginning), { status: 400 });
});
