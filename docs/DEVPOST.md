# HEIST — submission draft

This is preparation text. It does not indicate a submitted entry, hosted service, published repository, recorded video, or verified live Twitch broadcast. Replace evidence placeholders with actual links and results before submitting.

## Tagline

The streamer has the controls. Chat has the blueprints.

## Inspiration

A stream is more memorable when the audience has something meaningful to contribute. We wanted viewers to become necessary members of a crew, carrying information the streamer cannot see and helping turn a tense situation into a shared success.

## What it does

HEIST turns a Twitch stream into a cooperative vault escape. The streamer operates the controls while viewers join as the Cipher, Architect, or Lookout. Each role receives different intelligence. The crew must combine those clues to reconstruct an access code, disable an alarm circuit, and identify a safe exit before time runs out.

The experience includes a shared countdown, a three-strike alarm, audience communications, advisory votes, an OBS browser view, and an optional Twitch EventSub chat bridge. A labeled demo crew mode supports local rehearsals without pretending to be a live audience.

## How we built it

The implementation uses Node.js 24, browser JavaScript, CSS, and Canvas. A server-authoritative engine owns the puzzle answers, timer, and mission transitions. Server-sent events keep host, crew, and overlay views synchronized. Each crew session receives only its assigned role's current dossier; host and public state omit private clue data.

The Twitch bridge uses a broadcaster user access token and EventSub WebSockets to receive channel chat. Credentials remain server-side. Chat commands introduce the mission, share a participant's role clue, and register votes, while the host retains control over actions.

Codex helped implement the project across the game engine, interface, server, tests, and documentation. Before submission, replace this sentence with two concrete examples visible in the build chat and recording, and include the actual session ID obtained from `/status`.

## Challenges

The central design challenge was making every role useful without making the puzzles confusing. We separated information by role, kept each stage's decision clear, and made the audience's recommendations visible without allowing a vote to bypass the streamer's action.

The engineering challenge was maintaining one authoritative mission while presenting different information to different clients. The clock and puzzle logic live on the server, with separate projections for host, public viewers, and authenticated crew members.

## What we learned

Add observations from the verified playtest: which clue caused discussion, whether the clock created useful tension, and how viewers understood their role. Do not claim audience research that has not happened.

## What's next

Additional mission packs, creator-authored scenarios, accessibility options, and hosted onboarding could make repeat sessions easier. A production service would also need durable room state and robust multi-instance coordination.

## Required evidence before submission

- **Repository:** `TODO — public code URL or correctly shared private repository`.
- **Demo:** `TODO — accessible YouTube link, duration verified below three minutes`.
- **Codex session ID:** `TODO — copy actual ID from /status in the main build chat`.
- **Live Twitch evidence:** `TODO — record a real channel interaction and OBS scene`.
- **Validation:** `TODO — record actual test command and result for the submitted commit`.
- **Setup:** confirm a clean checkout can run with the documented Node version.
- **Assets:** confirm permission to use every third-party asset appearing in the video.
- **Entry:** verify the Devpost project shows Submitted, then retain confirmation. Saving a draft is not submission.

Official event: [Codex x TwitchCon Hackathon](https://twitchcon-codex.devpost.com/). Review [the official rules](https://twitchcon-codex.devpost.com/rules) before finalizing the entry.
