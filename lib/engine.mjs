import { randomBytes } from 'node:crypto';

export const ROLES = Object.freeze([
  { id: 'cipher', name: 'Cipher' },
  { id: 'architect', name: 'Architect' },
  { id: 'lookout', name: 'Lookout' },
]);

const MAX_MEMBERS = 500;
const MAX_COMMS = 80;
const MAX_EVENTS = 50;
const VALID_SOURCES = new Set(['crew', 'demo', 'twitch']);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function timestamp(now) {
  if (now === undefined) return Date.now();
  if (!Number.isFinite(now)) fail('Invalid mission timestamp.');
  return now;
}

function randomFor(seed) {
  let value = 2166136261;
  for (const char of String(seed)) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function dossier(role, objective, label, text) {
  return { role, name: ROLES.find(item => item.id === role).name, objective, clues: [{ label, text }] };
}

function makePuzzles(seed, previousCode) {
  const random = randomFor(seed);
  const symbols = shuffle(['MOON', 'EYE', 'CROWN', 'STAR'], random);
  const digits = shuffle(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], random).slice(0, 4);
  if (digits.join('') === previousCode) digits[0] = String((Number(digits[0]) + 1) % 10);
  const map = Object.fromEntries(symbols.map((symbol, index) => [symbol, digits[index]]));
  const split = shuffle(symbols, random);
  const show = pair => pair.map(symbol => `${symbol} = ${map[symbol]}`).join(' · ');
  const lock = {
    public: {
      id: 'lock', title: 'The outer lock', kicker: '01 / BREACH', kind: 'keypad', digits: 4,
      description: 'A four-digit cipher guards the vault. Your crew intercepted different pieces of its key.',
      instruction: 'Combine the symbol order with both intercepted digit mappings. Enter all four digits.',
      options: [],
    },
    answer: digits.join(''),
    dossiers: {
      architect: dossier('architect', 'Tell the operator the exact order of the four symbols.', 'Blueprint / reading order', `Read the four plates in this order: ${symbols.join(' → ')}. This order is current.`),
      cipher: dossier('cipher', 'Decode your two symbols and share their digits with the operator.', 'Intercept / fragment A', `${show(split.slice(0, 2))}. The Lookout has the other two mappings; the Architect knows the order.`),
      lookout: dossier('lookout', 'Share your two symbol readings. Every position matters.', 'Surveillance / fragment B', `${show(split.slice(2))}. The Cipher has the other two mappings; the Architect knows the order.`),
    },
  };

  const bits = [0, 1, 2].map(() => Math.floor(random() * 2));
  const deviations = shuffle([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]], random);
  const wireColors = [
    ['red', 'Red', '#fb7185'], ['amber', 'Amber', '#fbbf24'], ['cyan', 'Cyan', '#22d3ee'],
    ['violet', 'Violet', '#a78bfa'], ['white', 'White', '#e2e8f0'],
  ];
  const terminal = bit => bit ? 'B' : 'A';
  const pulse = bit => bit ? 'ODD' : 'EVEN';
  const seal = bit => bit ? 'BROKEN' : 'INTACT';
  const wireOptions = wireColors.map(([id, label, color], index) => {
    const values = bits.map((bit, bitIndex) => bit ^ deviations[index][bitIndex]);
    return { id, label, color, detail: `Terminal ${terminal(values[0])} · ${pulse(values[1])} pulse · ${seal(values[2])} seal` };
  });
  const alarm = {
    public: {
      id: 'alarm', title: 'Silence the alarm', kicker: '02 / DISARM', kind: 'wires', digits: 4,
      description: 'Five circuits. One safe bypass. Cutting the wrong wire advances the security alarm.',
      instruction: 'Ask all three specialists. Match the terminal, pulse, and seal before cutting one wire.',
      options: wireOptions,
    },
    answer: wireOptions[deviations.findIndex(values => values.every(value => value === 0))].id,
    dossiers: {
      architect: dossier('architect', 'Identify the correct terminal. Ask the others to narrow the circuit.', 'Engineering / terminal', `The safe bypass is connected to TERMINAL ${terminal(bits[0])}. Terminal alone is not enough: confirm pulse and seal.`),
      cipher: dossier('cipher', 'Identify the pulse parity. Combine it with the other two readings.', 'Oscilloscope / pulse', `Only an ${pulse(bits[1])} pulse carries the safe bypass. Confirm the terminal with Architect and the seal with Lookout.`),
      lookout: dossier('lookout', 'Identify the physical seal. The wrong bypass trips security.', 'Camera / physical seal', `The safe wire has a ${seal(bits[2])} seal. The wire colors are not a clue. Confirm terminal and pulse before the cut.`),
    },
  };

  const ring = shuffle(['iris', 'echo', 'nova'], random);
  const slot = Math.floor(random() * 3) + 1;
  const shift = Math.floor(random() * 2) + 1;
  const escape = {
    public: {
      id: 'escape', title: 'The final exit', kicker: '03 / EXTRACT', kind: 'doors', digits: 4,
      description: 'The artifact is yours. Lockdown has shifted the escape route. Choose the right airlock.',
      instruction: 'Find the original slot in the route ring, then apply the lockdown shift. Wrap around after the third position.',
      options: [
        { id: 'iris', label: 'IRIS', detail: 'Airlock 01 · botanical wing', color: '#69e2cc' },
        { id: 'echo', label: 'ECHO', detail: 'Airlock 02 · acoustic gallery', color: '#a78bfa' },
        { id: 'nova', label: 'NOVA', detail: 'Airlock 03 · observatory', color: '#fbbf24' },
      ],
    },
    answer: ring[(slot - 1 + shift) % 3],
    dossiers: {
      architect: dossier('architect', 'Read the original clockwise route ring to the crew.', 'Evacuation / route ring', `The ORIGINAL route ring, clockwise: ${ring.map(item => item.toUpperCase()).join(' → ')} → back to ${ring[0].toUpperCase()}. Start counting at 1.`),
      cipher: dossier('cipher', 'Reveal the original clearance slot. Lookout has the correction.', 'Dispatch / clearance slot', `The evacuation clearance selects SLOT ${slot} of the ORIGINAL ring. Count from 1. This slot must be corrected for the lockdown shift.`),
      lookout: dossier('lookout', 'Correct the original slot using the current lockdown shift.', 'Live camera / lockdown shift', `Lockdown moved the selected slot FORWARD ${shift} ${shift === 1 ? 'place' : 'places'} CLOCKWISE in the original ring. Wrap after the third position. Do not shift the printed door labels.`),
    },
  };
  return [lock, alarm, escape];
}

function event(room, title, detail, now, tone = 'info') {
  room.events.push({ id: `event-${++room.sequence}`, title, detail, time: now, tone });
  if (room.events.length > MAX_EVENTS) room.events.splice(0, room.events.length - MAX_EVENTS);
}

function comm(room, member, text, source, now) {
  room.comms.push({ id: `comm-${++room.sequence}`, name: member.name, role: member.role, text, source, time: now });
  if (room.comms.length > MAX_COMMS) room.comms.splice(0, room.comms.length - MAX_COMMS);
}

function remainingMs(room, now) {
  if (room.phase === 'briefing') return room.durationSeconds * 1000;
  if (room.paused || room.phase === 'escaped' || room.phase === 'caught') return room.remainingMs;
  return Math.max(0, room.endsAt - now);
}

function finish(room, phase, now, title, detail) {
  room.remainingMs = remainingMs(room, now);
  room.phase = phase;
  room.paused = false;
  room.endsAt = null;
  room.result = {
    title, detail,
    elapsedSeconds: Math.min(room.durationSeconds, Math.floor((room.durationSeconds * 1000 - room.remainingMs) / 1000)),
  };
  event(room, title, detail, now, phase === 'escaped' ? 'success' : 'danger');
}

export function createRoom({ id, seed, durationSeconds = 480, now } = {}) {
  now = timestamp(now);
  if (typeof id !== 'string' || !/^[a-z0-9-]{3,32}$/i.test(id)) fail('A valid mission ID is required.');
  if (!Number.isInteger(durationSeconds) || durationSeconds < 60 || durationSeconds > 1800) fail('Mission duration must be between 60 and 1800 seconds.');
  const secretSeed = seed === undefined ? randomBytes(24).toString('hex') : String(seed);
  const room = {
    id, secretSeed, generation: 0, durationSeconds, phase: 'briefing', stageIndex: 0,
    createdAt: now, startedAt: null, endsAt: null, paused: false, remainingMs: durationSeconds * 1000,
    alarm: 0, members: new Map(), comms: [], events: [], votes: new Map(), sequence: 0, result: null,
    puzzles: makePuzzles(`${secretSeed}:0`),
  };
  event(room, 'Mission assembled', 'The vault is ready. Assemble your crew, then start the breach.', now);
  return room;
}

export function joinRoom(room, { id, name, role } = {}, now) {
  now = timestamp(now);
  tick(room, now);
  if (typeof id !== 'string' || id.length < 1 || id.length > 128) fail('A valid crew identity is required.');
  const existing = room.members.get(id);
  if (existing) return { ...existing };
  if (room.members.size >= MAX_MEMBERS) fail('This mission has reached its crew limit.', 409);
  if (typeof name !== 'string') fail('Enter a crew callsign.');
  name = name.trim().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 24);
  if (name.length < 2) fail('Your callsign needs at least two characters.');
  if (role !== undefined && !ROLES.some(item => item.id === role)) fail('Choose Cipher, Architect, or Lookout.');
  if (!role) {
    const counts = Object.fromEntries(ROLES.map(item => [item.id, 0]));
    for (const member of room.members.values()) counts[member.role] += 1;
    role = [...ROLES].sort((first, second) => counts[first.id] - counts[second.id])[0].id;
  }
  const member = { id, name, role };
  room.members.set(id, member);
  event(room, `${name} joined the crew`, `${ROLES.find(item => item.id === role).name} intelligence channel assigned.`, now);
  return { ...member };
}

export function tick(room, now) {
  now = timestamp(now);
  if (room.phase === 'active' && !room.paused && now >= room.endsAt) {
    finish(room, 'caught', now, 'Lockdown complete', 'Time expired. Security sealed the vault before the crew could extract.');
    return true;
  }
  return false;
}

export function getState(room, { role = 'public', playerId } = {}, now) {
  now = timestamp(now);
  tick(room, now);
  const votes = new Map();
  for (const optionId of room.votes.values()) votes.set(optionId, (votes.get(optionId) || 0) + 1);
  const stage = room.puzzles[room.stageIndex].public;
  const state = {
    roomId: room.id, phase: room.phase, stageIndex: room.stageIndex, stageCount: room.puzzles.length,
    stage: structuredClone(stage),
    clock: { durationSeconds: room.durationSeconds, remainingSeconds: Math.ceil(remainingMs(room, now) / 1000), endsAt: room.phase === 'active' && !room.paused ? room.endsAt : null },
    alarm: { value: room.alarm, max: 3 },
    crew: {
      total: room.members.size,
      roles: ROLES.map(item => ({ ...item, count: [...room.members.values()].filter(member => member.role === item.id).length })),
    },
    members: [...room.members.values()].map(member => ({ ...member })),
    comms: room.comms.map(item => ({ ...item })), events: room.events.map(item => ({ ...item })),
    votes: [...votes.entries()].map(([optionId, count]) => ({ optionId, count })),
    result: room.result ? { ...room.result } : null, paused: room.paused,
  };
  if (role === 'viewer') {
    const member = room.members.get(playerId);
    if (!member) fail('Your crew session is not part of this mission.', 403);
    state.dossier = structuredClone(room.puzzles[room.stageIndex].dossiers[member.role]);
  }
  return state;
}

export function command(room, action, payload = {}, now) {
  now = timestamp(now);
  tick(room, now);
  if (action === 'reset') {
    const previousCode = room.puzzles[0].answer;
    room.generation += 1;
    room.puzzles = makePuzzles(`${room.secretSeed}:${room.generation}`, previousCode);
    room.phase = 'briefing';
    room.stageIndex = 0;
    room.paused = false;
    room.startedAt = null;
    room.endsAt = null;
    room.remainingMs = room.durationSeconds * 1000;
    room.alarm = 0;
    room.votes.clear();
    room.comms = [];
    room.events = [];
    room.result = null;
    event(room, 'New vault generated', 'Security codes and routing have changed. Crew assignments are retained.', now);
    return room;
  }
  if (action === 'start') {
    if (room.phase !== 'briefing') fail('The mission has already started. Reset to assemble a new vault.', 409);
    room.phase = 'active';
    room.startedAt = now;
    room.endsAt = now + room.durationSeconds * 1000;
    event(room, 'Breach initiated', 'The clock is running. Ask your crew for the cipher fragments.', now, 'success');
    return room;
  }
  if (!['pause', 'resume', 'submit'].includes(action)) fail('Unknown mission command.');
  if (room.phase !== 'active') fail('This mission is not active. Start a new breach before taking action.', 409);
  if (action === 'pause') {
    if (room.paused) fail('The mission is already paused.', 409);
    room.remainingMs = remainingMs(room, now);
    room.paused = true;
    room.endsAt = null;
    event(room, 'Operation paused', 'The countdown is frozen. Resume when the crew is ready.', now);
    return room;
  }
  if (action === 'resume') {
    if (!room.paused) fail('The mission is already running.', 409);
    room.paused = false;
    room.endsAt = now + room.remainingMs;
    event(room, 'Operation resumed', 'Countdown restored. The next move belongs to the crew.', now);
    return room;
  }
  if (room.paused) fail('Resume the mission before submitting a move.', 409);
  if (typeof payload.answer !== 'string') fail('Enter an answer before submitting.');
  const answer = payload.answer.trim().toLowerCase();
  const puzzle = room.puzzles[room.stageIndex];
  if (puzzle.public.kind === 'keypad' && !/^\d{4}$/.test(answer)) fail('The outer lock requires exactly four digits.');
  if (puzzle.public.kind !== 'keypad' && !puzzle.public.options.some(option => option.id === answer)) fail('Select one of the available options.');
  if (answer !== puzzle.answer) {
    room.alarm += 1;
    event(room, 'Security anomaly detected', `That move was incorrect. Alarm level ${room.alarm} of 3. Regroup with your crew.`, now, 'danger');
    if (room.alarm >= 3) finish(room, 'caught', now, 'Crew compromised', 'Three security anomalies triggered lockdown. The vault has sealed.');
    return room;
  }
  room.votes.clear();
  if (room.stageIndex === room.puzzles.length - 1) {
    finish(room, 'escaped', now, 'The perfect getaway', 'Artifact secured. Crew extracted. You made it out together.');
  } else {
    event(room, `${puzzle.public.title} cleared`, room.stageIndex === 0 ? 'Outer lock breached. The alarm circuits are exposed.' : 'Alarm disabled. The artifact is secured. Find the escape route.', now, 'success');
    room.stageIndex += 1;
  }
  return room;
}

export function chatMessage(room, { id, name, text, source = 'crew', role } = {}, now) {
  now = timestamp(now);
  tick(room, now);
  if (typeof text !== 'string' || !text.trim()) fail('Write a message before transmitting.');
  if (text.length > 500) fail('Keep transmissions under 500 characters.');
  if (!VALID_SOURCES.has(source)) fail('Unknown transmission source.');
  let member = room.members.get(id);
  if (!member) member = joinRoom(room, { id, name, role }, now);
  text = text.trim().replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  const latest = room.comms.at(-1);
  if (latest?.name === member.name && latest?.text === text && now - latest.time < 1000) return { replies: [] };
  const replies = [];
  const lower = text.toLowerCase();
  if (lower === '!heist') {
    const name = ROLES.find(item => item.id === member.role).name;
    const reply = `${member.name}, you are ${name}. Open the crew link for your private dossier. Use !clue to share your current fragment, or !vote <option> to recommend a move.`;
    comm(room, member, text, source, now);
    replies.push(reply);
  } else if (lower === '!clue') {
    const clue = room.puzzles[room.stageIndex].dossiers[member.role].clues.map(item => item.text).join(' ');
    comm(room, member, clue, source, now);
    replies.push(`${member.name} [${member.role}]: ${clue}`);
  } else if (/^!vote(?:\s|$)/.test(lower)) {
    if (room.phase !== 'active' || room.paused) fail('Votes open while the mission is running.', 409);
    const optionId = lower.slice(5).trim();
    const stage = room.puzzles[room.stageIndex].public;
    if (stage.kind === 'keypad' ? !/^\d{4}$/.test(optionId) : !stage.options.some(option => option.id === optionId)) {
      fail(stage.kind === 'keypad' ? 'Vote for a four-digit code: !vote 1234.' : `Vote for an available option: ${stage.options.map(option => option.id).join(', ')}.`);
    }
    room.votes.set(member.id, optionId);
    comm(room, member, text, source, now);
    replies.push(`${member.name} recommends ${optionId.toUpperCase()}. The operator makes the final move.`);
  } else {
    comm(room, member, text, source, now);
  }
  return { replies };
}
