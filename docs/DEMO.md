# HEIST demo recording plan

The cinematic production is documented in [the production folder](../video/heist-demo/README.md) and [its storyboard](../video/heist-demo/STORYBOARD.md). Both 2:49 cuts have Deepgram narration, original score/foley, burned captions and editable sources. The revised export at `artifacts/heist-final-demo/exports/HEIST-Demo.mp4` replaces the simulated insert with actual broadcaster Twitch pairing/vote footage and a verified one-account vote replacement. The successful escape remains labeled rehearsal. Independent viewers, a three-account live escape and OBS capture remain pending; the sequence below is the full live-verification recording plan.

Target duration: **2 minutes 45 seconds**, leaving room below the three-minute limit. Record a real run with the final code. Do not present demo crew messages as live audience participation.

## Prepare

- Start the server and create a fresh rehearsal for a solo demo, or choose **Create live mission** for a real Twitch recording. Modes cannot be switched.
- Open the host view, one browser crew view for each role, and the OBS overlay. Live companions must send their own one-time `!link` command and confirm the Twitch account before their dossier opens. Use three Twitch accounts to cover all live roles; multiple browsers of one account keep one role and one vote.
- Use three independent profiles or private browser contexts so each crew member has a distinct session.
- If recording the Twitch integration, configure the broadcaster's token, connect the bridge, and verify a real channel chat message appears in the room before recording.
- Keep tokens, environment files, private account details, and crew dossiers out of the main stream capture.
- Capture a brief Codex build clip showing a meaningful request, resulting code, and verification output. Retrieve the actual session ID with `/status`.

## Recording sequence

| Time | On screen | Narrative |
| --- | --- | --- |
| 0:00–0:15 | Vault, mission title, and three crew roles | “The streamer has the controls. Chat has the blueprints. Nobody can pull off this heist alone.” |
| 0:15–0:35 | Host creates a room; cut to three different dossiers | Show that each role sees different information. Explain the eight-minute clock and three-strike alarm. |
| 0:35–1:05 | Mission begins; crew shares code clues; streamer enters the code | Let the viewer see a concrete chain from separate evidence to one correct action. |
| 1:05–1:30 | Wire puzzle and audience vote | Show a chat command arriving from Twitch if live connection is verified. Demonstrate that voting helps the host decide. |
| 1:30–1:55 | Exit clues, countdown, successful extraction | Finish with a clear success moment. Choose a real run; do not edit a failed action into a successful result. |
| 1:55–2:15 | OBS view and mobile crew view | Explain how a creator adds the overlay and viewers join from another device. |
| 2:15–2:35 | Codex build clip and relevant test results | Show how Codex helped implement the authoritative engine, private role projections, or Twitch bridge. Only describe checks that passed. |
| 2:35–2:45 | Final HEIST screen | “A stream becomes a crew. The next move is yours.” |

## Evidence to capture

1. Different clue content in the three role views.
2. The streamer receiving public state without private dossiers.
3. A real input changing shared state across windows.
4. One live Twitch message entering the communications feed, if claiming the bridge works live.
5. The final mission outcome and a Codex-assisted implementation moment.

For an offline rehearsal, use the explicit demo controls and say “local rehearsal.” The hackathon demo should include verified footage of the project functioning on Twitch. Upload the final video to YouTube with access judges can view, then open the submitted link from another browser session and verify playback and duration.
