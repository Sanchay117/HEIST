import { randomBytes } from 'node:crypto';

export const PAIRING_TTL_MS = 120_000;
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };

/** One store per mission. Sessions are capabilities; only EventSub may claim a code. */
export function createPairingStore(roomId) {
  const codes = new Map();
  const attempts = new Map();
  let roomAttempts = { start: 0, count: 0 };

  function invalidate(session) {
    if (session.code) codes.delete(session.code);
    session.code = null;
    session.claim = null;
  }

  function expire(session, now) {
    if (!session.playerId && session.expiresAt && now >= session.expiresAt) {
      invalidate(session);
      session.expired = true;
    }
  }

  function issue(session, now) {
    if (session.playerId) fail('This browser is already linked. Its Twitch account cannot be overwritten.');
    if (!session.issueWindow || now - session.issueWindow.start >= 60_000) session.issueWindow = { start: now, count: 0 };
    if (++session.issueWindow.count > 3) fail('Too many code requests. Wait a minute before trying again.', 429);
    invalidate(session);
    // 80 random bits, plus an explicit mission prefix. No Math.random or user input.
    session.code = `${roomId}-${randomBytes(10).toString('hex').toUpperCase()}`;
    session.expiresAt = now + PAIRING_TTL_MS;
    session.expired = false;
    codes.set(session.code, session);
    return session;
  }

  function allowAttempt(playerId, now) {
    if (!roomAttempts.start || now - roomAttempts.start >= 60_000) roomAttempts = { start: now, count: 0 };
    let window = attempts.get(playerId);
    if (!window || now - window.start >= 60_000) {
      // Bound the map even when many different Twitch accounts guess codes.
      for (const [id, value] of attempts) if (now - value.start >= 60_000) attempts.delete(id);
      if (attempts.size >= 1000) fail('Pairing is busy. Wait a minute before trying again.', 429);
      window = { start: now, count: 0 };
      attempts.set(playerId, window);
    }
    window.count++;
    roomAttempts.count++;
    if (window.count > 5 || roomAttempts.count > 60) fail('Too many linking attempts. Wait a minute before trying again.', 429);
  }

  function claim(rawCode, player, now) {
    allowAttempt(player.id, now);
    const code = String(rawCode).trim().toUpperCase();
    if (!new RegExp(`^${roomId}-[A-F0-9]{20}$`).test(code)) fail('That code is invalid or expired. Request a new code in the companion.');
    const session = codes.get(code);
    if (!session) fail('That code is invalid or expired. Request a new code in the companion.');
    expire(session, now);
    if (session.playerId || !session.code) fail('That code is invalid or expired. Request a new code in the companion.');
    // Consume immediately, before the browser confirms. A second account cannot replace a claim.
    codes.delete(code);
    session.code = null;
    session.claim = { id: randomBytes(16).toString('hex'), playerId: player.id, name: player.name };
    return session;
  }

  function confirm(session, claimId, now, onConfirm = () => {}) {
    if (session.playerId) fail('This browser is already linked. Its Twitch account cannot be overwritten.');
    expire(session, now);
    if (!session.claim || session.claim.id !== claimId) fail('This confirmation is no longer valid. Request a new pairing code.');
    onConfirm(session.claim);
    session.playerId = session.claim.playerId;
    invalidate(session);
    return session.playerId;
  }

  function snapshot(session, now, available) {
    expire(session, now);
    if (session.playerId) return { status: 'linked' };
    if (!available) return { status: 'unavailable', reason: 'The host must connect or reconnect Twitch before you can link this browser.' };
    if (session.claim) return { status: 'confirm', expiresAt: session.expiresAt, claimId: session.claim.id, accountName: session.claim.name };
    if (session.expired || !session.code) return { status: 'expired', reason: 'This code expired. Request a new code.' };
    return { status: 'pending', code: session.code, expiresAt: session.expiresAt };
  }

  function reset(sessions) {
    codes.clear();
    for (const session of sessions) if (!session.playerId) {
      invalidate(session);
      session.expired = true;
    }
  }

  return { issue, claim, confirm, snapshot, reset };
}
