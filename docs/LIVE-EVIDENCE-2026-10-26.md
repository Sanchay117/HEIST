# Live Twitch checkpoints — 2026-10-26

Application commit: `5e7f79b` (subsequent changes are production evidence/documentation only).
Broadcaster/channel: `bravefart69420`. Mission: `48C039`.

## Observed directly

- The broadcaster completed Twitch's authorization-code flow. The resulting user token was validated for the configured Client ID and both `user:read:chat` and `user:write:chat`, then saved only in the ignored local `.env`. No credential value was displayed or included in screenshots.
- The normal production server started with that `.env`. The normal host UI created a live mission and displayed **Connected to bravefart69420** after connecting Twitch.
- The human sent `!heist` through real Twitch chat. HEIST's mission UI received it with the TWITCH source marker, assigned the account Cipher, and showed exactly one crew member.
- The real Twitch chat page visibly contained `[HEIST] bravefart69420, you are Cipher…`, confirming an actual outgoing role reply, rather than merely a successful HTTP request.
- The real Twitch chat page received `!link` and visibly published the pairing acknowledgment. The human confirmed the companion's Cipher dossier appeared in their own Chrome browser. The agent's separate companion browser was not linked, and is not evidence of a second verified browser.
- The human sent `!vote 1234` from the linked companion, followed by `!vote 5678` through real Twitch chat. The public game state recorded both accepted messages with the Cipher role and their correct `crew` / `twitch` sources, exactly one member (`twitch:811051974`), and exactly one final vote: `5678`, count `1`. This verifies companion-to-chat vote replacement in the real production path.
- Twitch visibly published the `5678` recommendation reply. Actual chat footage and game communications were captured without recording credential screens.
- The test mission later reached its eight-minute timeout with zero strikes. It was a transport/identity test with one account, not a successful three-role live escape. Both test votes were accepted before timeout; neither submitted an answer.
- After preserving the vote evidence, the operator reset the mission to its briefing. It returned to 08:00 with the Cipher member retained and the real Twitch connection still available. This leaves the room ready without consuming countdown time.

This account is also the broadcaster. These observations verify real chat transport, linked companion participation, one shared Cipher role and one cross-interface vote. They do not establish an independent viewer, complete three-role live mission, or audience test. The human confirmed only this one Twitch account is available.

## Local evidence files

Generated files are intentionally ignored by Git:

- `artifacts/live-verification/twitch-connected.png`: actual host connection status.
- `artifacts/live-verification/twitch-command-and-reply.png`: actual Twitch command and visible role reply.
- `artifacts/live-verification/48C039/events.jsonl`: changes from the public mission SSE projection, including source labels and receipt times.
- `artifacts/live-verification/48C039/source.json`: capture origin and limitations.
- `artifacts/live-verification/48C039/vote-result.json`: actual public game projection after the two accepted votes, retaining the one-vote result after timeout.
- `artifacts/live-verification/48C039/twitch-vote-and-reply.png` and `game-vote-comms.png`: actual Twitch reply and in-app communications.
- `artifacts/live-verification/48C039/footage/`: real browser captures, with source PNGs and wall-clock frame timing under `frames/`. `assemble-live-capture.py` preserves the recorded timing and repeats frames when encoding to 30 fps; it never reconstructs chat or game state.

The optional `node video/heist-demo/watch-live.mjs ROOM` captures public SSE changes for up to 30 minutes. It never reads Twitch credentials, browser control tokens, pairing tokens, or private dossiers. It does not produce a video recording.

## Still to verify

- A second independently linked browser sharing this account's role and vote through real Twitch. This already passes the local fixture tests, but was not repeated with the real channel.
- Real Twitch companion-first joining, reverse vote replacement, code expiry/replay, and reconnect behavior. These pass the automated/local browser tests; the real check above was chat-first and companion-to-chat replacement.
- An independent viewer sending a vote through Twitch, followed by the host UI update in a recording.
- Three actual Twitch identities receiving different dossiers and completing one mission.
- OBS source rendering, a valid local recording, and outbound stream/player verification. OBS was opened but no completed source or recording was verified.
- Public HTTPS companion reachability, reconnect recovery, long-session token validation, and audience load.

The original 2:49 rehearsal export remains available unchanged. The revised cut in `artifacts/heist-final-demo/` replaces its simulated insert with actual Twitch commands, replies, game communications, and the verified one-vote result. The escape story remains labeled rehearsal; the real insert is labeled **REAL TWITCH / BROADCASTER ACCOUNT TEST**. No OBS recording or three-account live escape is represented by that insert.
