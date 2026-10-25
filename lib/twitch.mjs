/**
 * Installed own-channel Twitch chat bridge. No credentials reach browser state.
 * https://dev.twitch.tv/docs/chat/authenticating/
 * https://dev.twitch.tv/docs/eventsub/handling-websocket-events/
 */
const ENDPOINT = 'wss://eventsub.wss.twitch.tv/ws';
const API = 'https://api.twitch.tv/helix';

export function isTwitchReconnectUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'wss:' && url.hostname === 'eventsub.wss.twitch.tv' && !url.port && !url.username && !url.password && url.pathname === '/ws';
  } catch { return false; }
}

export function createTwitchBridge({
  clientId = process.env.TWITCH_CLIENT_ID || '',
  accessToken = process.env.TWITCH_ACCESS_TOKEN || '',
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  onMessage = () => ({ replies: [] }),
  onStatus = () => {},
} = {}) {
  let socket = null;
  let pendingSocket = null;
  let retryTimer = null;
  let watchdog = null;
  let validationTimer = null;
  let stopped = true;
  let connecting = false;
  let connected = false;
  let status = 'disconnected';
  let identity = null;
  let retries = 0;
  let lastReplyAt = 0;
  let generation = 0;
  const seen = new Map();
  const configured = Boolean(clientId && accessToken);
  const headers = () => ({ Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId, 'Content-Type': 'application/json' });
  const snapshot = () => ({ configured, connected, status, channel: identity?.login || null });
  const change = (next, live = false) => {
    status = next;
    connected = live;
    try { onStatus(snapshot()); } catch { /* Observer cannot break the bridge. */ }
  };

  async function validate() {
    const response = await fetchImpl('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${accessToken}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Twitch token is invalid or expired. Replace TWITCH_ACCESS_TOKEN and restart.');
    const data = await response.json();
    if (data.client_id !== clientId) throw new Error('Twitch token belongs to a different client ID.');
    if (!data.user_id || !data.login || !Array.isArray(data.scopes) || !data.scopes.includes('user:read:chat')) {
      throw new Error('Use a broadcaster user token with the user:read:chat scope.');
    }
    if (identity && identity.user_id !== data.user_id) throw new Error('Twitch token identity changed. Disconnect and reconnect.');
    identity = data;
    return data;
  }

  function clearTimers() {
    clearTimeout(retryTimer); retryTimer = null;
    clearTimeout(watchdog); watchdog = null;
    clearInterval(validationTimer); validationTimer = null;
  }

  function closeSocket(value) {
    try { value?.close(); } catch { /* Already closed. */ }
  }

  function scheduleRetry() {
    if (stopped || retryTimer) return;
    change('reconnecting');
    clearTimeout(watchdog); watchdog = null;
    closeSocket(pendingSocket); pendingSocket = null;
    const previous = socket; socket = null; closeSocket(previous);
    const retryGeneration = generation;
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      if (stopped || generation !== retryGeneration) return;
      try { await validate(); if (!stopped && generation === retryGeneration) open(ENDPOINT, false); }
      catch (error) { if (!stopped && generation === retryGeneration) stopWithError(error.message); }
    }, Math.min(30000, 1000 * (2 ** Math.min(retries++, 5))));
    retryTimer.unref?.();
  }

  function stopWithError(message) {
    stopped = true; connecting = false; generation++;
    clearTimers();
    const old = socket; socket = null; closeSocket(old);
    const pending = pendingSocket; pendingSocket = null; closeSocket(pending);
    change(message);
  }

  function armWatchdog(seconds = 10) {
    clearTimeout(watchdog);
    watchdog = setTimeout(scheduleRetry, Math.max(10000, seconds * 1000) + 2000);
    watchdog.unref?.();
  }

  async function subscribe(sessionId) {
    const response = await fetchImpl(`${API}/eventsub/subscriptions`, {
      method: 'POST', headers: headers(), signal: AbortSignal.timeout(9000),
      body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: {
        broadcaster_user_id: identity.user_id, user_id: identity.user_id,
      }, transport: { method: 'websocket', session_id: sessionId } }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Twitch denied chat access. Check the token and user:read:chat scope.');
      throw new Error(`Twitch chat subscription failed (${response.status}). Try reconnecting.`);
    }
  }

  async function reply(text) {
    if (stopped || !connected || !identity?.scopes.includes('user:write:chat') || Date.now() - lastReplyAt < 1800) return;
    lastReplyAt = Date.now();
    try {
      const response = await fetchImpl(`${API}/chat/messages`, {
        method: 'POST', headers: headers(), signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ broadcaster_id: identity.user_id, sender_id: identity.user_id, message: `[HEIST] ${text}`.slice(0, 500) }),
      });
      if (response.status === 401) stopWithError('Twitch token expired. Replace the token and restart.');
    } catch { /* A failed optional reply must not disconnect incoming chat. */ }
  }

  function open(url, migrating) {
    if (stopped) return;
    let ws;
    try { ws = new WebSocketImpl(url); }
    catch { scheduleRetry(); return; }
    const currentGeneration = generation;
    if (migrating) pendingSocket = ws; else socket = ws;
    let keepalive = 10;
    const welcomeTimeout = setTimeout(() => {
      if (stopped || generation !== currentGeneration) return;
      if (migrating && pendingSocket === ws) { pendingSocket = null; closeSocket(ws); }
      scheduleRetry();
    }, 12000);
    welcomeTimeout.unref?.();
    ws.addEventListener('message', async ({ data }) => {
      if (stopped || generation !== currentGeneration || (ws !== socket && ws !== pendingSocket)) return;
      let message;
      try { message = JSON.parse(typeof data === 'string' ? data : String(data)); } catch { return; }
      const type = message.metadata?.message_type;
      if (type === 'session_welcome') {
        clearTimeout(welcomeTimeout);
        const session = message.payload?.session;
        if (!session?.id) { scheduleRetry(); return; }
        keepalive = Number(session.keepalive_timeout_seconds) || 10;
        if (migrating) {
          const previous = socket; socket = ws; pendingSocket = null; closeSocket(previous);
        } else {
          try { await subscribe(session.id); }
          catch (error) { if (!stopped && generation === currentGeneration) stopWithError(error.message); return; }
        }
        if (stopped || generation !== currentGeneration || ws !== socket) return;
        connecting = false; retries = 0; change('connected', true); armWatchdog(keepalive);
      } else if (type === 'session_keepalive') {
        if (ws === socket) armWatchdog(keepalive);
      } else if (type === 'session_reconnect') {
        if (pendingSocket) return;
        const reconnect = message.payload?.session?.reconnect_url;
        if (!isTwitchReconnectUrl(reconnect)) { stopWithError('Twitch sent an unexpected reconnect address. Please reconnect.'); return; }
        open(reconnect, true);
      } else if (type === 'revocation') {
        stopWithError('Twitch revoked chat access. Reauthorize the token and restart.');
      } else if (type === 'notification') {
        if (ws === socket) armWatchdog(keepalive);
        if (message.metadata?.subscription_type !== 'channel.chat.message') return;
        const event = message.payload?.event;
        const id = message.metadata?.message_id;
        if (!event?.chatter_user_id || !event.message?.text || event.broadcaster_user_id !== identity.user_id || (id && seen.has(id))) return;
        if (id) seen.set(id, Date.now());
        if (seen.size > 2000) seen.delete(seen.keys().next().value);
        // Own optional replies are ignored to avoid feedback loops.
        if (event.chatter_user_id === identity.user_id && event.message.text.startsWith('[HEIST]')) return;
        try {
          const result = await onMessage({ id: `twitch:${event.chatter_user_id}`, name: event.chatter_user_name || event.chatter_user_login, text: event.message.text, source: 'twitch' });
          if (result?.replies?.length) void reply(result.replies.join(' | '));
        } catch { /* A full/expired game room cannot crash socket delivery. */ }
      }
    });
    ws.addEventListener('close', () => {
      clearTimeout(welcomeTimeout);
      if (stopped || generation !== currentGeneration) return;
      if (ws === socket || ws === pendingSocket) scheduleRetry();
    });
    ws.addEventListener('error', () => {
      clearTimeout(welcomeTimeout);
      if (!stopped && generation === currentGeneration && (ws === socket || ws === pendingSocket)) scheduleRetry();
    });
  }

  return {
    getStatus: snapshot,
    async connect() {
      if (!configured) throw Object.assign(new Error('Add TWITCH_CLIENT_ID and TWITCH_ACCESS_TOKEN to .env, then restart. Demo play needs no credentials.'), { status: 409 });
      if (connected || connecting) return snapshot();
      stopped = false; connecting = true; generation++;
      const connectGeneration = generation;
      change('validating');
      try {
        await validate();
        if (stopped || generation !== connectGeneration) return snapshot();
        change('connecting'); open(ENDPOINT, false);
        validationTimer = setInterval(() => {
          validate().catch((error) => { if (!stopped) stopWithError(error.message); });
        }, 55 * 60 * 1000);
        validationTimer.unref?.();
        return snapshot();
      } catch (error) {
        if (generation !== connectGeneration) return snapshot();
        stopWithError(error.message);
        throw Object.assign(new Error(error.message), { status: 502 });
      }
    },
    disconnect() {
      stopped = true; connecting = false; generation++; clearTimers(); retries = 0; seen.clear();
      const previous = socket; socket = null; closeSocket(previous);
      const pending = pendingSocket; pendingSocket = null; closeSocket(pending);
      change('disconnected'); return snapshot();
    },
  };
}
