// Test-only transport. Imported by tests, never installed in the application server.
import { once } from 'node:events';
import { setImmediate as flush } from 'node:timers/promises';
import { createServer } from '../../server.mjs';

export async function startTwitchFixture() {
  const sockets = [];
  const outgoing = [];
  let clockOffset = 0;
  let sequence = 0;
  class Socket extends EventTarget {
    constructor(url) {
      super(); this.url = url; this.closed = false; sockets.push(this);
      queueMicrotask(() => this.message({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: `test-session-${sockets.length}`, keepalive_timeout_seconds: 600 } } }));
    }
    message(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
    close() { if (!this.closed) { this.closed = true; this.dispatchEvent(new Event('close')); } }
  }
  const server = createServer({ now: () => Date.now() + clockOffset, tickInterval: 50, twitchOptions: {
    clientId: 'test-client', accessToken: 'not-a-real-token', WebSocketImpl: Socket,
    fetchImpl: async (url, options) => {
      if (url.endsWith('/validate')) return Response.json({ client_id: 'test-client', user_id: '123', login: 'test_channel', scopes: ['user:read:chat', 'user:write:chat'] });
      if (url.endsWith('/chat/messages')) { outgoing.push(JSON.parse(options.body)); return Response.json({ data: [{ is_sent: true }] }); }
      return Response.json({ data: [{ id: 'test-subscription' }] }, { status: 202 });
    },
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, { token, body, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  async function create(mode = 'live') {
    const response = await call('/api/rooms', { body: { mode } });
    if (response.status !== 201) throw new Error(JSON.stringify(response));
    const room = response.body;
    room.path = `/api/rooms/${room.roomId}`;
    return room;
  }
  async function connect(room) {
    const response = await call(`${room.path}/twitch`, { token: room.hostToken, body: { action: 'connect' } });
    await flush(); await flush();
    if (response.status !== 200) throw new Error(JSON.stringify(response));
  }
  async function send(userId, text, name = `Viewer${userId}`) {
    const socket = sockets.findLast(item => !item.closed);
    if (!socket) throw new Error('No active mocked Twitch socket.');
    socket.message({ metadata: { message_type: 'notification', subscription_type: 'channel.chat.message', message_id: `event-${++sequence}` }, payload: { event: { broadcaster_user_id: '123', chatter_user_id: String(userId), chatter_user_name: name, message: { text } } } });
    await flush(); await flush();
  }
  return { server, base, call, create, connect, send, outgoing,
    advance(milliseconds) { clockOffset += milliseconds; },
    async close() { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); },
  };
}
