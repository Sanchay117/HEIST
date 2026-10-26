# HEIST: real Twitch and OBS verification

Status on 2026-10-26: 29 automated tests, 26 rehearsal browser checks, and 14 pairing/solo browser checks passed locally. Real broadcaster authorization, a connected Twitch subscription, an incoming `!heist` command, Cipher assignment, and the outgoing role reply visible in Twitch chat are now verified. The command was sent from the broadcaster account, not a separate viewer. Real pairing, votes, an independent viewer, OBS capture, public viewer deployment, and live broadcast remain unverified. See [the live evidence record](LIVE-EVIDENCE-2026-10-26.md); the remaining steps below are a runbook.

## What the evidence actually proves

| Area | Verified | Still unverified |
| --- | --- | --- |
| Game and HTTP server | Automated engine/API tests, including complete solutions across 100 seeds, role projections, clock, auth, and SSE updates | Behavior under a real stream's audience size and network conditions |
| Browser UI | Recorded browser report: 26 checks, three independent crew sessions, complete escape, pause/resume, fail/reset, voting, mobile layouts, escaping | Human audience comprehension and effects of Twitch video latency |
| Identity linking | Local API tests for both join orders, shared roles/votes, account overwrite protection, code expiry/replay/mission binding, guessing limits, and disconnected states | Real viewers sending pairing commands through Twitch and confirming in their own browsers |
| Twitch bridge | Mocked lifecycle checks; real broadcaster token validation and connection; real incoming `!heist`, Cipher assignment, and a role reply visibly published in Twitch chat | A separate viewer, pairing and votes through Twitch, recovery and long-session behavior, audience bursts, and delivery of every optional reply |
| OBS overlay | `/overlay/ROOM` rendered in Chrome at 1920 × 1080, followed the mission outcome, and had no operator buttons | Rendering/transparency/live updates in OBS's embedded browser and visibility in an actual recording or stream |
| Remote companion | Local browser joins and private dossiers | A viewer outside this computer opening a public HTTPS crew link |

The identity implementation is covered by `test/pairing.test.mjs`. `test/pairing-browser.mjs` also passed 14 checks with zero browser runtime errors, including the complete anonymous solo demo. The optional `test/pairing-browser.mjs` starts a local application with test-only mocked Twitch transport; its report goes to `artifacts/pairing-browser/report.json`. Neither the fixture nor its credential substitutes are available through production routes.

Reproduce source checks with `npm run check` and `npm test`. The prior browser report is `artifacts/browser/report.json` (intentionally ignored by Git); `test/browser-smoke.mjs` reproduces the browser checks when Playwright and Chromium are available. Mocked Twitch tests do not contact Twitch.

## 1. Authorize the broadcaster's own channel

This implementation uses the installed-chatbot model: the token owner is both the broadcaster and the chat-reading user. Optional replies are sent as that broadcaster. There is no separate bot-account setup or channel-name selector.

1. Follow [Twitch's app registration instructions](https://dev.twitch.tv/docs/authentication/register-app/). The account must have verified email and 2FA. For the CLI route below, use an app that supplies a client secret and register the exact OAuth redirect `http://localhost:3000`. If only one redirect is needed, remove any extra blank redirect field; do not leave an empty second entry after clicking Add.
2. Install the [official Twitch CLI](https://dev.twitch.tv/docs/cli/) if it is missing. On macOS its documented command is `brew install twitchdev/twitch/twitch-cli`.
3. Stop HEIST before requesting the user token. The CLI's OAuth callback also uses port 3000; leave that port free until token creation finishes.
4. Run `twitch configure`. Enter this application's client ID and client secret at its local prompts.
5. Run:

   ```sh
   twitch token --user-token --scopes "user:read:chat user:write:chat"
   ```

6. Authorize while logged into the **broadcaster account whose channel will host HEIST**. Use the returned user access token, not the refresh token or client secret, in HEIST.
7. In the Twitch folder, copy `.env.example` to `.env` only if you have not already configured it. Set `TWITCH_CLIENT_ID` and `TWITCH_ACCESS_TOKEN` locally. `.env` is ignored by Git. HEIST itself does not use the client secret or refresh token.
8. Run `npm start`, open `http://127.0.0.1:3000`, and choose **Create live mission**. Rehearsal remains anonymous and cannot connect Twitch or be switched to live. Keep this operator tab open.
9. Open **Broadcast setup → Connect Twitch**. Wait for **Connected to YOUR_CHANNEL**. The UI checks the status every five seconds.

`user:read:chat` is required; `user:write:chat` enables replies. This follows [Twitch's installed-chatbot scopes](https://dev.twitch.tv/docs/chat/authenticating/), [CLI configuration](https://dev.twitch.tv/docs/cli/configure-command/), and [user-token instructions](https://dev.twitch.tv/docs/cli/token-command/).

**Checkpoint:** a connected status means the bridge validated the token and received a successful subscription response. It does not prove any viewer message arrived or any reply was published. If the wrong channel appears, the token belongs to the wrong account. A client-ID mismatch or expired token is reported by the connection control.

## 2. Receive a real viewer command

Use a second Twitch account as the viewer so this tests a real viewer identity. Demo controls are unavailable in a live mission.

Before requesting a code, open the crew page while the bridge is disconnected: it should show **Twitch pairing unavailable**, with no dossier or voting controls. Connect the bridge and verify that **Get pairing code** becomes available. Then:

1. Request a code in the companion and send its exact `!link ROOM-CODE` command in Twitch chat.
2. Return to the companion. It should identify the responding Twitch account and ask for **Confirm account**. Before confirming, verify no private clue or companion vote is available.
3. Check the account name, confirm, and verify the assigned dossier opens. The code must not appear in host mission comms; the command itself is visible in Twitch chat.
4. Open an independent browser, repeat pairing with the same Twitch account, and verify both dossiers have the same role and the crew count has not increased.
5. Vote in chat, change the vote from one browser, then from the other browser. Confirm the total remains one vote for that account and both companions show the latest accepted vote.
6. Retry a consumed code from another account. Verify the linked browser retains its original account. A linked browser must not offer a replacement code.
7. Test a fresh code after two minutes, and test a code from a different mission. Neither should link a browser. Disconnect/reconnect to verify unavailable/recovery states.

Repeat with `!heist` sent before opening the first companion. The role must match in both join orders. These pairing checks have passed against mocked Twitch locally, not a real channel.

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
- Live chat and confirmed companion sessions share the canonical Twitch user ID. Linking is verified from the chat event sender, not a typed callsign. One account has one role and one latest vote; anonymous identities are allowed only in rehearsal.
- Any incoming nonempty Twitch chat message other than a linking attempt currently enrolls its sender. The displayed crew count means enrolled identities, not currently connected viewers.
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
5. On a phone using mobile data, open the link, get a pairing code, send it in Twitch chat, and confirm the displayed account before the dossier appears. Relay a clue and verify it reaches the host. A same-computer test does not prove this path.

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
- Real `!link` received and account confirmed in the companion:
- Same role and single vote across two real browsers:
- Expired/reused/wrong-mission pairing commands rejected live:
- Real `!heist` / `!clue` received in HEIST:
- Actual outgoing `[HEIST]` reply visible in Twitch:
- Real wire/exit vote changed host UI:
- Remote private companion opened over mobile data:
- OBS local recording file:
- Twitch player/VOD evidence:
- Network-reconnect check:
- Long-session check:
- Failures or limitations observed:
