# Live Twitch checkpoints — 2026-10-26

Application commit: `5e7f79b` (subsequent changes are production evidence/documentation only).
Broadcaster/channel: `bravefart69420`. Mission: `48C039`.

## Observed directly

- The broadcaster completed Twitch's authorization-code flow. The resulting user token was validated for the configured Client ID and both `user:read:chat` and `user:write:chat`, then saved only in the ignored local `.env`. No credential value was displayed or included in screenshots.
- The normal production server started with that `.env`. The normal host UI created a live mission and displayed **Connected to bravefart69420** after connecting Twitch.
- The human sent `!heist` through real Twitch chat. HEIST's mission UI received it with the TWITCH source marker, assigned the account Cipher, and showed exactly one crew member.
- The real Twitch chat page visibly contained `[HEIST] bravefart69420, you are Cipher…`, confirming an actual outgoing role reply, rather than merely a successful HTTP request.
- The mission remained at its briefing with the clock at 08:00, so preparation did not consume mission time.

This account is also the broadcaster. These observations verify real chat transport; they do not establish an independent viewer, complete live mission, or audience test.

## Local evidence files

Generated files are intentionally ignored by Git:

- `artifacts/live-verification/twitch-connected.png`: actual host connection status.
- `artifacts/live-verification/twitch-command-and-reply.png`: actual Twitch command and visible role reply.
- `artifacts/live-verification/48C039/events.jsonl`: changes from the public mission SSE projection, including source labels and receipt times.
- `artifacts/live-verification/48C039/source.json`: capture origin and limitations.

The optional `node video/heist-demo/watch-live.mjs ROOM` captures public SSE changes for up to 30 minutes. It never reads Twitch credentials, browser control tokens, pairing tokens, or private dossiers. It does not produce a video recording.

## Still to verify

- Companion `!link` delivery, account confirmation, and the same Cipher role after chat-first joining.
- Cross-interface replacement of the same account's vote, and another linked browser sharing that role and vote.
- An independent viewer sending a vote through Twitch, followed by the host UI update in a recording.
- Three actual Twitch identities receiving different dossiers and completing one mission.
- OBS source rendering, a valid local recording, and outbound stream/player verification. OBS was opened but no completed source or recording was verified.
- Public HTTPS companion reachability, reconnect recovery, long-session token validation, and audience load.

The exported 2:49 video remains the clearly labeled rehearsal cut. These new screenshots and public updates do not convert its simulated pairing insert or rehearsal votes into live footage.
