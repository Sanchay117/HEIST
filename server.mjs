import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRoom, joinRoom, getState, command, chatMessage, tick } from './lib/engine.mjs';
import { createTwitchBridge } from './lib/twitch.mjs';
import { createPairingStore } from './lib/pairing.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const ROLES = ['cipher', 'architect', 'lookout'];
const ROOM_LIFETIME = 6 * 60 * 60 * 1000;
const MAX_BODY = 16 * 1024;
const secureToken = () => randomBytes(32).toString('base64url');
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const sameToken = (one, two) => {
  if (typeof one !== 'string' || typeof two !== 'string') return false;
  const first = Buffer.from(one); const second = Buffer.from(two);
  return first.length === second.length && timingSafeEqual(first, second);
};

function readJson(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw error('Send JSON with Content-Type: application/json.', 415);
  return new Promise((resolveBody, reject) => {
    let bytes = 0;
    const parts = [];
    req.on('data', (part) => {
      bytes += part.length;
      if (bytes > MAX_BODY) { req.pause(); reject(error('Request is too large.', 413)); }
      else parts.push(part);
    });
    req.on('end', () => {
      try {
        const result = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw error('Expected a JSON object.');
        resolveBody(result);
      } catch (cause) { reject(cause.status ? cause : error('Invalid JSON.')); }
    });
    req.on('error', () => reject(error('Request interrupted.')));
    req.on('aborted', () => reject(error('Request interrupted.')));
  });
}

/** Returns an ordinary node:http Server. Call listen(0) for an isolated test server. */
export function createServer({
  publicDir = join(ROOT, 'public'),
  now = Date.now,
  maxRooms = 50,
  maxPlayers = 1000,
  maxClients = 1000,
  publicOrigin = process.env.PUBLIC_ORIGIN || '',
  twitchOptions = {},
  tickInterval = 1000,
} = {}) {
  const rooms = new Map();
  const requestRates = new Map();
  const pairingRates = new Map();
  let twitchRoomId = null;
  let clientCount = 0;
  const normalizeOrigin = (value) => { try { return new URL(value).origin; } catch { return null; } };

  const bridge = createTwitchBridge({
    ...twitchOptions,
    onMessage: (message) => {
      const record = rooms.get(twitchRoomId);
      if (!record || record.mode !== 'live' || !/^twitch:\d+$/.test(message.id)) return { replies: [] };
      if (/^!link(?:\s|$)/i.test(message.text.trim())) {
        // Pairing commands never enter shared communications or enroll a guest.
        if (!bridge.getStatus().connected) return { replies: ['Pairing is unavailable until Twitch reconnects.'] };
        try {
          record.pairing.claim(message.text.trim().slice(5).trim(), { id: message.id, name: message.name }, now());
          broadcast(record);
          return { replies: ['Pairing request received. Confirm your Twitch account in the companion browser.'] };
        } catch (cause) { return { replies: [cause.message] }; }
      }
      const state = getState(record.room, {}, now());
      const existing = state.members.find((member) => member.id === message.id);
      if (!existing && state.members.length >= maxPlayers) return { replies: [] };
      joinRoom(record.room, { id: message.id, name: message.name }, now());
      const result = chatMessage(record.room, message, now());
      broadcast(record);
      return result;
    },
    onStatus: () => {
      const record = rooms.get(twitchRoomId);
      if (record) broadcast(record);
    },
  });

  function json(res, body, status = 200) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  }

  function credentials(req, url) {
    const auth = req.headers.authorization;
    if (auth && !auth.startsWith('Bearer ')) throw error('Invalid authorization header.', 401);
    const token = auth?.slice(7) || (url.pathname.endsWith('/events') ? url.searchParams.get('token') : null);
    if (token && token.length > 256) throw error('Invalid session token.', 401);
    return token;
  }

  function projection(record, token) {
    if (!token) return { role: 'public' };
    if (sameToken(record.hostToken, token)) return { role: 'host' };
    const session = record.viewers.get(token);
    if (!session) throw error('Session expired. Rejoin this crew.', 401);
    return { role: session.playerId ? 'viewer' : 'pending', playerId: session.playerId, session };
  }

  function requireHost(record, token) {
    if (!token || !sameToken(record.hostToken, token)) throw error('Only the mission host can use these controls.', 403);
  }

  function roomBridge(record) {
    const status = bridge.getStatus();
    return twitchRoomId === record.room.id ? { connected: status.connected, status: status.status, channel: status.channel } : { connected: false, status: 'disconnected', channel: null };
  }

  function publicState(record, viewer) {
    const state = getState(record.room, viewer, now());
    state.mode = record.mode;
    state.bridge = roomBridge(record);
    if (viewer.session && record.mode === 'live') state.pairing = record.pairing.snapshot(viewer.session, now(), state.bridge.connected);
    if (viewer.role === 'viewer') {
      const member = record.room.members.get(viewer.playerId);
      state.identity = { ...member, verified: record.mode === 'live', vote: record.room.votes.get(member.id) || null };
    }
    return state;
  }

  function writeEvent(client, record) {
    if (client.res.destroyed || client.res.writableEnded) return;
    // Disconnect slow readers instead of retaining an unbounded socket buffer.
    if (client.res.writableLength > 256 * 1024) { client.res.destroy(); return; }
    try { client.res.write(`data: ${JSON.stringify(publicState(record, projection(record, client.token)))}\n\n`); }
    catch { client.res.destroy(); }
  }

  function broadcast(record) {
    for (const client of record.clients) writeEvent(client, record);
  }

  function destroyRecord(id, record) {
    for (const client of record.clients) client.res.end();
    rooms.delete(id);
    if (twitchRoomId === id) { bridge.disconnect(); twitchRoomId = null; }
  }

  function expireRooms() {
    const timestamp = now();
    for (const [id, record] of rooms) if (timestamp - record.createdAt > ROOM_LIFETIME) destroyRecord(id, record);
  }

  function enforceOrigin(req) {
    const origin = req.headers.origin;
    const allowed = new Set([`http://${req.headers.host}`, `https://${req.headers.host}`]);
    if (publicOrigin) allowed.add(normalizeOrigin(publicOrigin));
    if ((origin && !allowed.has(normalizeOrigin(origin))) || req.headers['sec-fetch-site'] === 'cross-site') {
      throw error('Open HEIST directly to use mission controls.', 403);
    }
  }

  function enforceRate(req) {
    const key = req.socket.remoteAddress || 'local';
    const timestamp = now();
    let rate = requestRates.get(key);
    if (!rate || timestamp - rate.start > 60000) { rate = { start: timestamp, count: 0 }; requestRates.set(key, rate); }
    if (++rate.count > 300) throw error('Too many requests. Wait a moment and try again.', 429);
    if (requestRates.size > 2000) for (const [address, value] of requestRates) if (timestamp - value.start > 60000) requestRates.delete(address);
  }

  function enforcePairingIssueRate(req) {
    const key = req.socket.remoteAddress || 'local';
    const timestamp = now();
    for (const [id, value] of pairingRates) if (timestamp - value.start >= 60_000) pairingRates.delete(id);
    let window = pairingRates.get(key);
    if (!window) {
      if (pairingRates.size >= 2000) throw error('Pairing is busy. Try again shortly.', 429);
      window = { start: timestamp, count: 0 }; pairingRates.set(key, window);
    }
    if (++window.count > 20) throw error('Too many pairing code requests. Wait a minute before trying again.', 429);
  }

  async function serveStatic(req, res, pathname) {
    if (!['GET', 'HEAD'].includes(req.method)) throw error('Method not allowed.', 405);
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { throw error('Invalid path.', 400); }
    const appRoute = decoded === '/' || /^\/(play|crew|overlay)\/[A-Z0-9]{6}\/?$/i.test(decoded);
    const asset = appRoute ? 'index.html' : decoded.replace(/^\/+/, '');
    if (!asset || asset.split('/').some((part) => part === '..' || part.startsWith('.')) || !TYPES[extname(asset)]) throw error('Not found.', 404);
    const file = resolve(publicDir, asset);
    if (!file.startsWith(`${resolve(publicDir)}/`)) throw error('Not found.', 404);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > 20 * 1024 * 1024) throw error('Not found.', 404);
      const body = req.method === 'HEAD' ? null : await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(asset)], 'Content-Length': info.size,
        'Cache-Control': asset === 'index.html' ? 'no-store' : 'no-cache',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
      });
      res.end(body);
    } catch (cause) { if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') throw error('Not found.', 404); throw cause; }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://heist.local');
      if (!url.pathname.startsWith('/api/')) { await serveStatic(req, res, url.pathname); return; }
      if (req.method === 'GET' && url.pathname === '/api/health') { json(res, { ok: true }); return; }
      if (!['GET', 'POST'].includes(req.method)) throw error('Method not allowed.', 405);
      enforceRate(req);
      if (req.method === 'POST') enforceOrigin(req);
      expireRooms();

      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        const body = await readJson(req);
        if (rooms.size >= maxRooms) throw error('Mission capacity reached. Try again later.', 503);
        const durationSeconds = body.durationSeconds ?? 480;
        const mode = body.mode ?? 'rehearsal';
        if (!['rehearsal', 'live'].includes(mode)) throw error('Choose rehearsal or live mission mode.');
        if (!Number.isInteger(durationSeconds) || durationSeconds < 60 || durationSeconds > 1800) throw error('Mission duration must be 60–1800 seconds.');
        let id;
        do { id = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(id));
        const hostToken = secureToken();
        const record = { room: createRoom({ id, durationSeconds, now: now() }), mode, pairing: createPairingStore(id), hostToken, viewers: new Map(), clients: new Set(), createdAt: now() };
        rooms.set(id, record);
        json(res, { roomId: id, hostToken, state: publicState(record, { role: 'host' }) }, 201);
        return;
      }

      const match = /^\/api\/rooms\/([a-zA-Z0-9]{6})\/(join|pairing|state|events|action|chat|demo|twitch)$/.exec(url.pathname);
      if (!match) throw error('API route not found.', 404);
      const [, requestedId, route] = match;
      const roomId = requestedId.toUpperCase();
      const record = rooms.get(roomId);
      if (!record) throw error('Mission not found or expired. Create a new heist.', 404);
      const token = credentials(req, url);

      if (req.method === 'POST' && route === 'join') {
        if (record.mode === 'live') throw error('Live missions require a verified Twitch link. Use chat-code pairing to join.', 403);
        const body = await readJson(req);
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 32) throw error('Choose a callsign between 1 and 32 characters.');
        if (body.role && !ROLES.includes(body.role)) throw error('Choose Cipher, Architect, or Lookout.');
        if (record.viewers.size >= maxPlayers || publicState(record, {}).members.length >= maxPlayers) throw error('This crew is full.', 409);
        const playerId = `crew:${randomBytes(12).toString('hex')}`;
        const player = joinRoom(record.room, { id: playerId, name: body.name.trim(), role: body.role }, now());
        const viewerToken = secureToken();
        record.viewers.set(viewerToken, { playerId });
        json(res, { viewerToken, playerId, role: player.role, state: publicState(record, { role: 'viewer', playerId }) });
        broadcast(record); return;
      }

      if (req.method === 'POST' && route === 'pairing') {
        if (record.mode !== 'live') throw error('Rehearsal uses anonymous crew joins. Start a new live mission to pair Twitch accounts.');
        const body = await readJson(req);
        const action = body.action ?? 'start';
        if (!['start', 'confirm'].includes(action)) throw error('Choose start or confirm for pairing.');
        const existing = token ? projection(record, token) : null;
        if (existing && existing.role !== 'pending') throw error('This browser is already linked or is the operator. Its account cannot be overwritten.', 409);
        if (!roomBridge(record).connected) throw error('Pairing is unavailable. Ask the host to connect or reconnect Twitch.', 409);
        if (action === 'confirm') {
          if (!existing) throw error('Start pairing in this browser first.', 401);
          record.pairing.confirm(existing.session, body.claimId, now(), (claim) => {
            if (!record.room.members.has(claim.playerId) && record.room.members.size >= maxPlayers) throw error('This crew is full.', 409);
            joinRoom(record.room, { id: claim.playerId, name: claim.name }, now());
          });
          json(res, publicState(record, projection(record, token))); broadcast(record); return;
        }
        enforcePairingIssueRate(req);
        if (!existing && record.viewers.size >= maxPlayers) throw error('This mission has reached its browser session limit.', 409);
        const session = existing?.session || { playerId: null };
        record.pairing.issue(session, now());
        const viewerToken = token || secureToken();
        record.viewers.set(viewerToken, session);
        json(res, { viewerToken, state: publicState(record, projection(record, viewerToken)) });
        return;
      }

      const viewer = projection(record, token);
      if (req.method === 'GET' && route === 'state') { json(res, publicState(record, viewer)); return; }
      if (req.method === 'GET' && route === 'events') {
        if (clientCount >= maxClients || record.clients.size >= 250) throw error('Live connection capacity reached. Try again shortly.', 503);
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'Referrer-Policy': 'no-referrer' });
        res.flushHeaders();
        const client = { res, token };
        record.clients.add(client); clientCount++;
        let cleaned = false;
        const cleanup = () => { if (cleaned) return; cleaned = true; record.clients.delete(client); clientCount--; };
        res.on('close', cleanup); res.on('error', cleanup);
        writeEvent(client, record); return;
      }

      if (route === 'twitch') {
        requireHost(record, token);
        if (req.method === 'POST') {
          const body = await readJson(req);
          if (body.action === 'disconnect') {
            if (twitchRoomId === roomId) { bridge.disconnect(); twitchRoomId = null; broadcast(record); }
          } else if (body.action === 'connect') {
            if (record.mode !== 'live') throw error('Rehearsal stays anonymous. Create a new live mission to connect Twitch.', 409);
            if (twitchRoomId && twitchRoomId !== roomId) throw error('Twitch is connected to another mission. Disconnect it there first.', 409);
            twitchRoomId = roomId;
            try { await bridge.connect(); } catch (cause) { twitchRoomId = null; throw cause; }
          } else throw error('Choose connect or disconnect.');
        }
        const status = bridge.getStatus();
        json(res, twitchRoomId === roomId ? status : { ...status, connected: false, status: 'disconnected', channel: null });
        return;
      }

      if (req.method !== 'POST') throw error('Method not allowed.', 405);
      if (route === 'action') {
        requireHost(record, token);
        const body = await readJson(req);
        if (typeof body.action !== 'string' || !['start', 'pause', 'resume', 'reset', 'submit'].includes(body.action)) throw error('Unknown mission action.');
        command(record.room, body.action, { answer: body.answer }, now());
        if (body.action === 'reset') record.pairing.reset(record.viewers.values());
        json(res, publicState(record, viewer)); broadcast(record); return;
      }
      if (route === 'chat') {
        if (viewer.role !== 'viewer') throw error('Join the crew to send a transmission.', 403);
        const body = await readJson(req);
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 500) throw error('Transmission must contain 1–500 characters.');
        if (/^!link(?:\s|$)/i.test(body.text.trim())) throw error('Send linking commands in Twitch chat, not companion communications.');
        const player = publicState(record, viewer).members.find((member) => member.id === viewer.playerId);
        if (!player) throw error('Rejoin this crew.', 401);
        chatMessage(record.room, { id: player.id, name: player.name, text: body.text.trim(), source: 'crew' }, now());
        json(res, publicState(record, viewer)); broadcast(record); return;
      }
      if (route === 'demo') {
        requireHost(record, token);
        if (record.mode !== 'rehearsal') throw error('Demo crew is available in rehearsal only. Live missions require verified Twitch viewers.', 403);
        const body = await readJson(req);
        if (!ROLES.includes(body.role)) throw error('Choose Cipher, Architect, or Lookout.');
        if (body.text !== undefined && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 500)) throw error('Demo transmission must contain 1–500 characters.');
        const player = joinRoom(record.room, { id: `demo:${body.role}`, name: { cipher: 'Echo', architect: 'Blueprint', lookout: 'Ghost' }[body.role], role: body.role }, now());
        const dossier = publicState(record, { role: 'viewer', playerId: player.id }).dossier;
        const text = body.text?.trim() || (dossier?.clues || []).map((clue) => `${clue.label}: ${clue.text}`).join(' ').slice(0, 500) || 'Standing by. Start the mission to receive intelligence.';
        chatMessage(record.room, { id: player.id, name: player.name, text, source: 'demo' }, now());
        json(res, publicState(record, viewer)); broadcast(record); return;
      }
      throw error('Method not allowed.', 405);
    } catch (cause) {
      const status = Number.isInteger(cause.status) && cause.status >= 400 && cause.status < 600 ? cause.status : 500;
      if (status === 500) console.error('HEIST request failed:', cause.message);
      json(res, { error: status === 500 ? 'Mission control encountered an error. Try again.' : cause.message }, status);
    }
  });

  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const timer = setInterval(() => {
    expireRooms();
    for (const record of rooms.values()) { tick(record.room, now()); if (record.clients.size) broadcast(record); }
  }, tickInterval);
  timer.unref();
  server.on('close', () => {
    clearInterval(timer); bridge.disconnect();
    for (const record of rooms.values()) for (const client of record.clients) client.res.end();
    rooms.clear();
  });
  // Close persistent SSE clients before http.Server.close waits for them.
  const close = server.close.bind(server);
  server.close = (callback) => {
    for (const record of rooms.values()) for (const client of record.clients) client.res.end();
    bridge.disconnect();
    return close(callback);
  };
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.on('error', (cause) => { console.error(`HEIST could not start: ${cause.message}`); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`\n  HEIST · The streamer has the controls. Chat has the clues.\n  Local: http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}\n`));
  const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
