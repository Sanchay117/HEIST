# HEIST: real Twitch and OBS verification

Status on 2026-10-25: local game and browser checks passed. No real Twitch account, real viewer command, OBS application capture, public viewer deployment, or live broadcast has been verified. The steps below are a runbook, not completed live-test evidence.

## What the evidence actually proves

| Area | Verified | Still unverified |
| --- | --- | --- |
| Game and HTTP server | Automated engine/API tests, including complete solutions across 100 seeds, role projections, clock, auth, and SSE updates | Behavior under a real stream's audience size and network conditions |
| Browser UI | Recorded browser report: 26 checks, three independent crew sessions, complete escape, pause/resume, fail/reset, voting, mobile layouts, escaping | Human audience comprehension and effects of Twitch video latency |
| Twitch bridge | Mocked token validation, subscription request, incoming event processing, identity/role assignment, duplicate suppression, reconnect migration, and outgoing reply request | Twitch accepting our real credentials/subscription, delivering real events, and publishing replies |
| OBS overlay | `/overlay/ROOM` rendered in Chrome at 1920 × 1080, followed the mission outcome, and had no operator buttons | Rendering/transparency/live updates in OBS's embedded browser and visibility in an actual recording or stream |
| Remote companion | Local browser joins and private dossiers | A viewer outside this computer opening a public HTTPS crew link |

Reproduce source checks with `npm run check` and `npm test`. The prior browser report is `artifacts/browser/report.json` (intentionally ignored by Git); `test/browser-smoke.mjs` reproduces the browser checks when Playwright and Chromium are available. Mocked Twitch tests do not contact Twitch.

## 1. Authorize the broadcaster's own channel

This implementation uses the installed-chatbot model: the token owner is both the broadcaster and the chat-reading user. Optional replies are sent as that broadcaster. There is no separate bot-account setup or channel-name selector.

1. Follow [Twitch's app registration instructions](https://dev.twitch.tv/docs/authentication/register-app/). The account must have verified email and 2FA. For the CLI route below, use an app that supplies a client secret and register the exact OAuth redirect `http://localhost:3000`.
2. Install the [official Twitch CLI](https://dev.twitch.tv/docs/cli/) if it is missing. On macOS its documented command is `brew install twitchdev/twitch/twitch-cli`.
3. Stop HEIST before requesting the user token. The CLI's OAuth callback also uses port 3000; leave that port free until token creation finishes.
4. Run `twitch configure`. Enter this application's client ID and client secret at its local prompts.
5. Run:

   ```sh
   twitch token --user-token --scopes "user:read:chat user:write:chat"
   ```

6. Authorize while logged into the **broadcaster account whose channel will host HEIST**. Use the returned user access token, not the refresh token or client secret, in HEIST.
7. In the Twitch folder, copy `.env.example` to `.env` only if you have not already configured it. Set `TWITCH_CLIENT_ID` and `TWITCH_ACCESS_TOKEN` locally. `.env` is ignored by Git. HEIST itself does not use the client secret or refresh token.
8. Run `npm start`, open `http://127.0.0.1:3000`, and create a mission using **Assemble your crew**. Keep this operator tab open.
9. Open **Broadcast setup → Connect Twitch**. Wait for **Connected to YOUR_CHANNEL**. The UI checks the status every five seconds.

`user:read:chat` is required; `user:write:chat` enables replies. This follows [Twitch's installed-chatbot scopes](https://dev.twitch.tv/docs/chat/authenticating/), [CLI configuration](https://dev.twitch.tv/docs/cli/configure-command/), and [user-token instructions](https://dev.twitch.tv/docs/cli/token-command/).

**Checkpoint:** a connected status means the bridge validated the token and received a successful subscription response. It does not prove any viewer message arrived or any reply was published. If the wrong channel appears, the token belongs to the wrong account. A client-ID mismatch or expired token is reported by the connection control.

## 2. Receive a real viewer command

Use a second Twitch account as the viewer so this tests a real viewer identity. Keep demo crew controls unused during this test.

| Viewer action | Expected HEIST evidence | Additional Twitch evidence |
| --- | --- | --- |
| Send `!heist` in the broadcaster's channel | A crew identity is enrolled; its message appears in **Live comms** with a **TWITCH** source label and specialist role | With write scope, a `[HEIST]` reply names the assigned role |
| Wait at least two seconds, then send `!clue` | That viewer's current specialist clue appears in host comms with the same role and **TWITCH** label | With write scope, the broadcaster account posts the clue back to chat |
| Host begins the mission and completes the outer lock; viewer sends `!vote cyan` | During the wire stage, the Cyan card's vote count updates | With write scope, a recommendation reply appears |
| Viewer changes the vote to `!vote red` | The same viewer's vote moves to Red rather than accumulating votes | A later recommendation may be acknowledged |
| Crew supplies the remaining clues and the operator submits the correct move | The next objective loads; host, companion, and overlay update | Twitch itself does not execute operator actions |

The wire vote is advisory; selecting the most popular option never automatically solves the stage. During the lock stage a vote must be a four-digit code, and during the exit stage use `iris`, `echo`, or `nova`. Votes require an active, unpaused mission. The host renders option vote counts for wires and exits; keypad guesses remain visible as chat messages.

Record a viewer sending a command and the corresponding host update together. That is the missing evidence for the real incoming path:

```text
Viewer Twitch chat → Twitch EventSub → HEIST server → mission state → operator UI
```

### Current limitations that affect this test

- `!clue` deliberately shares the clue into public mission communications and optionally public Twitch chat. It is not a whisper. The companion dossier is the private view until the viewer shares it.
- Chat and companion identities are independent. Typing the same name does not link them. Select your chat-assigned role on the companion page if you want matching clues; the two identities can both count toward the crew total.
- Any incoming nonempty Twitch chat message currently enrolls its sender. The displayed crew count means enrolled identities, not currently connected viewers.
- Optional replies are throttled globally: commands arriving less than 1.8 seconds after the previous reply may receive no reply, although incoming commands can still be processed. Allow at least two seconds between verification commands.
- The bridge sends a reply request but does not currently inspect Twitch's `is_sent`/`drop_reason` result or display every non-401 send failure. An incoming clue in HEIST is not proof the outgoing reply was published. Check Twitch chat itself; [Twitch documents these delivery fields](https://dev.twitch.tv/docs/api/reference/#send-chat-message).
- There is no automatic access-token refresh. An expired/revoked token must be replaced and the server restarted. Restarting clears rooms; reconnect the channel and replace the OBS room URL afterward.
- Only one mission can own the Twitch bridge at a time. Disconnect it from the previous mission before switching.

## 3. Give remote viewers their private dossiers

Incoming Twitch commands and local OBS can work with the server on this computer. Remote companion pages need a separate public reachability setup.

1. Use an HTTPS deployment or tunnel that forwards to this same HEIST process and supports server-sent events. This has not been deployed or verified yet.
2. Set `PUBLIC_ORIGIN` to that exact HTTPS origin if the proxy requires it, then restart before creating the test room. A tunnel sharing the local server need not expose the server on every local interface.
3. Open the operator UI through the public origin and create the mission there, so **Invite your crew** produces a public `/crew/ROOM` URL. A room already created locally uses the same room ID on a tunnel to that same process; its crew URL can also be rewritten to the public origin manually.
4. Share only the crew URL. Keep the operator credential private.
5. On a phone using mobile data, open the link, join a role, and confirm its dossier appears. Relay a clue and verify it reaches the host. A same-computer test does not prove this path.

A separate deployed server has separate room memory. Do not create the room locally and expect an unrelated deployment to know it.

## 4. Show the result in OBS

The overlay is a HUD: timer, strikes, objective progression, crew count, and final outcome. It does not contain the vault camera animation, chat feed, or interactive puzzle terminal. Show the full game by capturing the operator browser window; add the HUD over a game/camera scene when useful.

1. Keep HEIST running and the operator tab open at `/play/ROOM`.
2. In OBS, add a window capture for the operator browser if you want viewers to see the vault and controls. On macOS choose the available screen/window capture source and target that browser window. Do not capture the private dossier windows or credential-creation terminal.
3. For the HUD, add **Sources → + → Browser**, keep **Local file** off, and set URL to `http://127.0.0.1:3000/overlay/ROOM` with the actual room code. **Broadcast setup** also provides a copyable overlay URL.
4. Set Width **1920**, Height **1080**. Place the browser source above the scene content. Keep the transparent background CSS; initially leave **Shutdown source when not visible** and **Refresh browser source when scene becomes active** off. These are [documented OBS browser-source properties](https://obsproject.com/kb/browser-source).
5. If OBS runs on another computer, use the reachable HEIST server origin rather than that computer's localhost.
6. Make a short local recording. Pause/resume the mission; confirm the OBS timer follows. Trigger a real viewer wire vote in the captured host window, submit the correct move, and finish the mission. Confirm objective progression and the final outcome appear in the recording. The HUD alone does not display the vote list.
7. To verify the broadcast path, stream the scene and watch it from the separate viewer account/device. Confirm the same outcome arrives after the expected stream delay. Measure whether that delay makes clue coordination confusing.

**Evidence boundary:** Chrome rendering proves the web view works. The OBS preview proves OBS loaded it. A local recording proves capture/encoding. Seeing the result in the Twitch player proves the outbound stream reached Twitch. Each is a separate checkpoint, and none of the OBS/broadcast checkpoints is completed yet.

## 5. Recovery and duration checks still to perform

- Briefly interrupt network access, restore it, and confirm the bridge reconnects and a new viewer command arrives. [Twitch does not replay events lost during a disconnected interval](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/); resend a test command after reconnection.
- Leave a real channel session running past the 55-minute token-validation interval and confirm fresh commands still arrive. The validation timer exists in code; a real long-session test has not run.
- Switch OBS scenes away and back and confirm the HUD remains current. Refreshing an overlay should rejoin the same room, whereas restarting HEIST destroys it.
- Observe command bursts and optional reply behavior with several real viewers. No real-audience load test or Twitch stream-delay compensation has been verified.

## Live evidence record

Fill these only after performing the checks, without recording access tokens or client secrets:

- Git commit tested:
- Broadcaster channel:
- Viewer account(s):
- Connected status observed:
- Real `!heist` / `!clue` received in HEIST:
- Actual outgoing `[HEIST]` reply visible in Twitch:
- Real wire/exit vote changed host UI:
- Remote private companion opened over mobile data:
- OBS local recording file:
- Twitch player/VOD evidence:
- Network-reconnect check:
- Long-session check:
- Failures or limitations observed:
