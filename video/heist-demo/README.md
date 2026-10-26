# HEIST — editable cinematic demo production

The independent production is a **2:49 rehearsal cut**, not verified live Twitch footage. It uses a fresh successful run of the actual app, three automated browser participants, a real companion HTTP vote and the real eight-minute countdown, condensed in the edit. The pairing insert is explicitly labeled **SIMULATED TWITCH**. Its source is the existing test-only transport, never a production authentication bypass.

## Deliverables

All generated media is under `artifacts/heist-demo/`:

- `exports/HEIST-Rehearsal-Demo.mp4`: 1920 × 1080, 30 fps, H.264/AAC, burned captions.
- `exports/HEIST-Thumbnail.png` and `.jpg`: original layout using the real vault view.
- `captions.srt`, `captions.json`, `transcript.txt`, `narration-timing.json`: editable copy and timing.
- `audio/narration.wav`, `music.wav`, `effects.wav`, `final-mix.wav`: separate stems and the normalized master.
- `footage/host.webm`, `cipher.webm`, `architect.webm`, `lookout.webm`: original continuous browser recordings. `capture.json` records the actual outcome, vote, scene markers, and source classifications.
- `footage/pairing.webm`: simulated Twitch transport, clearly disclosed in the edit.
- `exports/scenes/scene_*.mp4`, `HEIST-edit.edl`, `project.json`: scene precomps, cut list, and fully editable script/layout/timing.
- `qa/`: test evidence, narration transcription, loudness measurements, contact sheets and verification results.
- `exports/HEIST-Production.zip`: source, footage, stems, fonts/licenses and edit instructions. No environment files, API keys, browser profiles or authorization headers.

The EDL references the scene precomps. To change graphics or burned captions, edit `project.json`, `captions.json` or `render.py` and rerender; a video editor can trim/reorder the precomps and remix the separate stems.

## Rebuild

Requirements: Python 3, ffmpeg/ffprobe, Pillow, NumPy, OpenCV, SoundFile, Requests, FontTools and Brotli. The source app itself remains dependency-free. For fresh recording, Playwright and Chrome are also required; set `PLAYWRIGHT_MODULE` to a module path if it is not installed in the ordinary module search path, and optionally set `CHROME_BIN`.

From the HEIST repository root:

```sh
# Optional fresh capture: an actual eight-minute mission, followed by source preservation.
node video/heist-demo/record.mjs

# Narration: reads the authorized key from the original sibling Appwrite .env.
# Existing matching clips are cached. The key is never printed or written elsewhere.
python3 video/heist-demo/narrate.py
python3 video/heist-demo/audio.py
python3 video/heist-demo/render.py --preview
python3 video/heist-demo/render.py
python3 video/heist-demo/verify.py
python3 video/heist-demo/package.py
```

`render.py --scene 06` rerenders only that scene. Run `python3 video/heist-demo/render.py --assemble` to assemble the updated scene sequence without rerendering the other scenes. An existing complete source bundle can be edited and rendered using the cached narration without any API access.

## Narration and sound

Deepgram's official current REST API is `POST /v1/speak`, authenticated with an in-memory `Authorization: Token` header. Voice: `aura-2-draco-en`, a British baritone offered for storytelling. Source audio is linear16 WAV at 48 kHz. The Codex evidence chapter is edited at 1.18× tempo to fit its 13-second window without changing pitch.

References: [Deepgram TTS API](https://developers.deepgram.com/reference/text-to-speech/speak-request), [voices](https://developers.deepgram.com/docs/tts-models), [media output](https://developers.deepgram.com/docs/tts-media-output-settings). A generated-narration transcription pass uses the documented [pre-recorded audio API](https://developers.deepgram.com/docs/pre-recorded-audio) for wording/timing verification. No user recordings are uploaded.

Music and effects are original deterministic synthesis in `audio.py`: a restrained minor-key pulse, mechanical clicks, low vault releases and a brief pre-extraction dropout. Music is ducked under narration; `qa/audio-mix.json` records the measured margin. The master targets −16 LUFS and −1.5 dBTP.

The build chapter shows actual Codex-built source plus freshly executed checks. It does not imitate the Codex interface. Native Codex screen capture was unavailable, so it uses a designed source/evidence presentation.

## What still needs the user and real Twitch

No Twitch credentials were configured during the original rehearsal production. After export, real broadcaster authorization, an incoming `!heist`, and a visibly published role reply were verified; see [the live evidence record](../../docs/LIVE-EVIDENCE-2026-10-26.md). The command came from the broadcaster account. No independent viewer vote, real pairing, OBS recording, public viewer deployment or live broadcast is claimed, and the exported cut has not yet been replaced with live footage.

**Current next step:** pair the broadcaster's companion through the normal chat-code flow, then check vote replacement across interfaces. For a fresh setup, follow `docs/LIVE-TEST.md` to authorize the broadcaster, start HEIST, choose **Create live mission**, and connect the channel. Generate the token before starting HEIST because the CLI callback also uses port 3000.

While the real mission is running, `node video/heist-demo/watch-live.mjs ROOM` archives changes from its public SSE projection under `artifacts/live-verification/ROOM/`. This is supplementary event evidence, not video footage; it contains no private dossiers or control credentials.

For a fully live three-role story, have the broadcaster plus two viewer accounts available (three Twitch identities total). Each account gets one role. Each companion must request its own `!link` code, send it from that account in channel chat, and confirm the account name. A real viewer then votes; record both the chat command and corresponding host vote count, followed by the successful escape in that same mission. Keep all credentials and private account settings outside the recording.

The editable timeline reserves scene06 (01:16–01:34) for the vote and scene07 (01:34–01:48) for identity linking. Replace those with verified real footage, update their narration/disclosures, and rerender. For a fully live mission recording, replace the other app scenes with the corresponding live mission sources too. Do not remove rehearsal labels from footage that remains rehearsal.

Browser rendering of the HUD has passed. OBS itself and the outbound Twitch stream still need the separate checkpoints in `docs/LIVE-TEST.md`. The real-channel capture is required before calling the video submission-ready.
