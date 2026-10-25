# HEIST implementation contract

Local Node 24 application, dependency-free browser client, HTTP JSON + SSE, vanilla CSS/JS. Repository root is Twitch. Node built-in WebSocket for Twitch EventSub. All files and Git stay here.

## Engine (`lib/engine.mjs`)

Exports mutable-room functions `createRoom({id, seed, durationSeconds=480, now=Date.now()})`, `joinRoom(room, {id, name, role}, now)`, `getState(room, {role='public', playerId}, now)`, `command(room, action, payload={}, now)`, `chatMessage(room, {id,name,text,source='crew'}, now)`, `tick(room, now)`.

Host commands: start, pause, resume, reset, submit (payload.answer string). Errors throw Error with status 400/409. `joinRoom` returns `{id,name,role}`. Requested role can be cipher, architect, lookout, otherwise balanced assignment. chatMessage returns `{replies: string[]}` for Twitch replies and adds messages to state. Commands !heist, !clue, !vote <optionId>. One latest vote per participant per stage, never auto-solves. Repeated identical messages may be ignored. Engine is server-authoritative and clock based on timestamps, not tick counts. Reset rotates puzzle and clears votes. Stages: keypad (four digits), wires (five named colored wires), doors (three labeled exits). Cipher, architect, lookout each have meaningful distinct clues; all required facts are collectively sufficient to solve. Wrong submit adds alarm; 3 mistakes or timeout => caught. All 3 solved => escaped. Pause freezes countdown.

Public getState JSON (also host JSON): `{roomId,phase,stageIndex,stageCount:3,stage:{id,title,kicker,description,kind,instruction,options:[{id,label,detail,color}],digits:4},clock:{durationSeconds,remainingSeconds,endsAt},alarm:{value,max:3},crew:{total,roles:[{id,name,count}]},members:[{id,name,role}],comms:[{id,name,text,source,time,role}],events:[{id,title,detail,time,tone}],votes:[{optionId,count}],result:null|{title,detail,elapsedSeconds},paused:boolean}`. phase is briefing/active/escaped/caught. Stage ids are lock, alarm, escape. kind is keypad/wires/doors. The viewer projection adds `dossier:{role,name,clues:[{label,text}],objective}` for ONLY the authorized player role and current stage. Host/public never receive clues, seed, or answers. Array event order oldest-first. Valid option ids stable, lowercase ASCII. time is epoch ms. End result may include debrief, optional. command returns updated room or state (server simply reprojects after mutations). getState ticks before returning.

## Server (`server.mjs`, `lib/twitch.mjs`)

`createServer({ ... })` export for tests; direct node server.mjs starts on 127.0.0.1:3000 (HOST/PORT override). GET /api/health => `{ok:true}`.

- POST /api/rooms `{durationSeconds?,mode?:'rehearsal'|'live'}` => 201 `{roomId,hostToken,state}`
- POST /api/rooms/:id/join rehearsal only `{name,role?}` => `{viewerToken,playerId,role,state}`
- GET /api/rooms/:id/state with Authorization bearer optional => state, viewer gets dossier, public gets public.
- GET /api/rooms/:id/events?token=... => SSE `data: <state>\n\n` (default unnamed message), immediate initial then mutation/tick updates.
- POST /api/rooms/:id/action Authorization host => `{action,answer?}` => state (host projection)
- POST /api/rooms/:id/chat Authorization viewer => `{text}` => viewer state (no host bypass)
- POST /api/rooms/:id/demo Authorization host => `{role:'cipher'|'architect'|'lookout',text?}`. Rehearsal only. Explicit demo participant shares current role's clue; marks source demo and creates demo crew member; caller may send custom simulated text. Never claims live Twitch.
- GET /api/rooms/:id/twitch Authorization host => `{configured,connected,status,channel}`
- POST /api/rooms/:id/twitch Authorization host `{action:'connect'|'disconnect'}` => status, connects using server env TWITCH_CLIENT_ID + TWITCH_ACCESS_TOKEN (user token with user:read:chat, optional user:write:chat), validation determines broadcaster identity (own-channel installed integration). No credentials in browser. One active room Twitch bridge at a time, explicit disconnect.

All errors JSON `{error:'human-readable'}` with proper status. Host + viewer bearer tokens generated crypto.randomBytes. Compare origin for mutations, bounded JSON, bounded room/player limits, secure static file allowlist, room expiration, do not return tokens to public state. GET static fallback index.html for /play/:id /crew/:id /overlay/:id. Host browser keeps token in sessionStorage (optional #host= link captured and removed); viewer session token in localStorage by room. Overlay uses public state.

## Frontend (root agent)

Owns all public/ files. Full screen mission control, cyan/amber noir vault, a canvas pseudo-3D vault scene, left crew roster, right comms, timer, 3 objective steps, interactive puzzle panel. Landing at / with mission briefing and launch; /play/:id host; /crew/:id private role clue; /overlay/:id clean OBS read-only. Demo crew panel explicit and host-only; real Twitch connection status distinguished.

## Live identity linking

Room mode is immutable, default rehearsal. Twitch connection is live-only. Live joins reject the anonymous join endpoint and demo endpoint. All live state projections add `mode` and public `bridge:{connected,status,channel}`. Pending browser tokens authorize public state plus only that session's `pairing`; they cannot retrieve a dossier, send messages, or vote.

`POST /api/rooms/:id/pairing {action:'start'}` (optional existing pending bearer token) returns `{viewerToken,state}`. The private `pairing` projection is pending `{status:'pending',code,expiresAt}`, claimed `{status:'confirm',claimId,accountName,expiresAt}`, expired `{status:'expired',reason}`, or unavailable `{status:'unavailable',reason}`. A linked token cannot issue a new code or rebind to another account. Bridge connection is required for issuing and confirming.

Only the trusted EventSub callback can claim a code with `!link CODE`; companion chat rejects that command. Claim consumes the code before confirmation and never enters public comms. `POST /api/rooms/:id/pairing {action:'confirm',claimId}` with the original browser token resolves the canonical `twitch:<user ID>` member and upgrades that token. Existing roles are reused; new roles are balanced once. The live viewer projection then contains the dossier and `identity:{id,name,role,verified:true,vote}`. Rehearsal identities have verified:false. SSE resolves each token on every update, including connections opened before pairing.

Pairing codes: mission ID plus 80 cryptographic random bits, two-minute lifetime, single claim, session-bound confirmation. Limits: five claims/attempts per Twitch account and 60 per mission per minute; three code requests per session and 20 per IP per minute. Reset invalidates pending codes/claims but retains confirmed members; restart discards all memory. A disconnected bridge blocks new pairing but confirmed companions remain authorized.
