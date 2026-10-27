# Design

## Context

See proposal.md - Why. The current state that shapes the approach:

- **Hold detection** is in `packages/perception/src/gestures/hand-machine.ts`. A pinch held for `holdMs` (800 ms) that moved less than `holdMaxMove` (0.04 of the frame width) emits one `pinch.hold`, and the same pinch then goes on as a drag. Today that drag steers the ring.
- **Routing** is in `apps/web/src/tools/input-router.ts`, which maps `hold.left` and `hold.right` (from `packages/protocol/src/bindings.ts`) to `tools-ring`, `create-ring` or a one-shot command. `PaletteMachine` and `slotAt` in `apps/web/src/tools/palette.ts` already do ring geometry, highlighting and release.
- **Voice** is in `apps/web/src/voice/`:
  - `listeners.ts` runs Silero VAD (`@ricky0123/vad-web`), with `speechStart`/`speechEnd` and `finish()` delivering the speech so far, and on-device transcription in `transcriber.worker.ts`.
  - `voice-input.ts` owns the review countdown.
  - `utterance-context.ts` captures elements rested on for 300 ms or more, or tapped.
  - `apps/web/src/agent/addressing.ts` already does forgiving name matching (case, punctuation, one letter of difference).
- **Settings** live in `.hai/settings.json` through `apps/bridge/src/settings.ts`. Legacy binding keys are migrated there on load.
- **Agent context:** the agent sees the user's context through `get_user_context` (`apps/bridge/src/mcp/scene-tools.ts`) and through the context block before each request.

## Goals / Non-Goals

**Goals:**
- One hold state machine per hand that owns talk, the silent ring fallback and flicks, so a hold never does two things.
- Voice gets the same tool reach as the hands, with no LLM in the path.
- References the agent can use (target, points, sketches, markers) go through the one existing context block. The agent has no new tools.

**Non-Goals:**
- No change to how a pinch, a hold or a drag is detected in perception.
- No new speech engine and no wake word.
- No sketch or marker geometry in Rhino. The agent can turn them into Rhino geometry with its own Python.

## Decisions

### 1. The hold is a small state machine in the input router

The states, per hand:
- `idle`
- `held(target)`: the hold fired, the mic is starting and the progress ring is full.
- `speaking`: VAD reported `speechStart`.
- `flicking(slot)`: moved past the dead zone before any speech.
- `ringShown`: 600 ms of silence. This can combine with flicking.

Release resolves each state:
- `speaking` sends the transcript.
- `flicking` chooses the slot.
- `held` or `ringShown` in the centre cancels.

Speech wins any race. If VAD reports speech before the release, a pending flick is dropped. The machine is a pure class with injected events and clock, like `PaletteMachine`, so every scenario is a unit test.
- *Rejected:* opening the ring and listening as two separate gestures. Too few distinct, reliable webcam gestures remain.
- *Rejected:* letting a flick and speech both apply. One hold would then do two things, and an undo could not reverse it as one.

### 2. The microphone starts when the hold fires, not when the pinch starts

Every tap begins as a pinch, so starting the mic at pinch-down would flash Mic on for every tap and break the explicit-action promise. The progress ring tells the user when to speak.
- *Rejected:* a rolling pre-roll buffer from pinch-down. That keeps the mic live without an explicit action.

The VAD model is loaded at first engagement, so the first hold does not wait for it. The mic itself only starts when the hold fires. One detector is kept for the whole session (`listeners.ts`): its stream opens on `start()` and every track stops on `pause()`, so the microphone is off between listens while the model, the audio context and the worklet stay warm. Measured: live 46 to 58 ms after the hold, off within 20 ms of letting go; the first hold of a session also opens the device and builds the audio graph, about 0.4 s.

### 3. Held utterances end on release, not on silence

The listener is started with silence ending turned off. On release the router calls `finish()`, which delivers the speech so far, and the transcript goes straight to send, skipping the countdown in `voice-input.ts`. A send-time flag `held: true` lets the 1.5 s "shake to stop" window take priority in the nod and shake order.
- *Rejected:* keeping the 1.5 s countdown for held requests. The hold is already deliberate, and a countdown after a release feels like lag.

### 4. Points are captured by resting, through the drawing aids

Point capture lives in `utterance-context.ts` beside element capture and uses the same 300 ms rest rule. Points resolve through the same `resolve` the tools use, so a point near a wall end lands on it. Continuous paths during speech are not recorded; resting is clearer, and the agent gets a few points instead of hundreds.
- *Rejected:* recording the whole hand path. It is noisy at webcam rates and hard to read in a context block.

### 5. Rings are the action ring and the reference ring, and storage keeps its keys

`palette` and `createPalette` stay as the storage keys, for the action ring and the reference ring. The binding values are renamed to `action-ring` and `reference-ring` (the code says what the ring is), and the old `tools-ring` and `create-ring` are rewritten by the migration. The new binding value `talk` is the default for both holds. Which ring a `talk` hold falls back to comes from `dominantHand` (`Right` | `Left`), a new top-level setting.

The migration is a pure function in `packages/protocol` (`migrateRingSettings`), run by `apps/bridge/src/settings.ts` on load, which writes the file back when it changed anything:
- A layout equal to a previous default becomes null, so the app's new default applies.
- A long pinch that still does what the old defaults did (stored per hand, as the old shared key, or not stored at all) loses its stored value, so `talk` applies to both hands.
- `tools-ring` and `create-ring` elsewhere become `action-ring` and `reference-ring`; everything else is kept as it is.

*Rejected:*
- Renaming the storage keys. That costs a migration for every user and gains nothing.
- One combined 16-slot ring. Its slots are too small to flick reliably at webcam precision.

### 6. Sketch and marker tools sit on a reference layer, not the scene

The three tools live in a new `apps/web/src/tools/reference.ts`. The reference layer has two parts:
- **Sketches** are held in web state (at most 8). They are drawn with `setOverlay` in the hand's colour, cleared when a request is sent, and never sent as scene transactions, so Undo never touches them.
- **Markers** are kept by the bridge in `.hai/markers.json`, through a small `markers.set` message, because they must outlive a restart and be visible to agents in other sessions.

Both reach the agent only through the context block and `get_user_context`.
- *Rejected:* making sketches scene elements. They would show up in the model and the undo history, and owners and claims would apply to them.
- *Rejected:* a separate `get_sketches` MCP tool. It is one more tool to learn, when `get_user_context` is already called for "this".

### 7. Spoken tool names come from the registry

`Tool` gains `spoken: string[]`. The first entry is shown in the ring and defaults to the lower-cased label. A new `apps/web/src/voice/tool-commands.ts` runs before agent addressing:
1. Normalise the transcript (lower case, no punctuation).
2. Strip a leading "use" or "tool".
3. Match the whole remainder against every available tool's spoken names, allowing one letter of difference for names of five letters or more. This reuses the edit-distance helper from `addressing.ts`.

A match runs `controller.choose(tool)` and never reaches the agent. A match only counts when the whole transcript is a tool name, so "measure the distance between these towers" stays a request.
- *Rejected:* letting the agent set the tool (an MCP `set_tool`). That costs a full LLM turn for a one-word command, and lets an agent change the user's mode.
- *Rejected:* matching a tool name anywhere in the sentence. "Move the stair" must reach the agent.

### 8. Counters are local React state

The counters are kept in the Detection card's store and reset when the camera starts. Nothing persists or leaves the machine, in keeping with the desktop app's no-telemetry rule.

## Latency budget

Each budget is measured in the named test, with injected events and `performance.now()` marks:

| Step | Budget | Measured in |
|---|---|---|
| Hold fired to mic live (VAD started) | under 150 ms | Playwright with the fake microphone |
| Release to request sent | under 100 ms after the final transcript | Bridge test with the fake agent CLI |
| Utterance end to tool active for a spoken tool name | under 300 ms, transcription included | E2E with a recorded utterance |
| Silent flick release to tool active | under 50 ms | Router unit test |

A request never waits on anything new: the target and points are resolved before release.

## Risks / Trade-offs

- **[The user starts talking before the mic is live, so the first word is lost]** → The progress ring and the chip say "Listening" the moment the mic is live. The spike measures time to first speech, and a shorter `holdMs` reduces the gap.
- **[VAD reports speech late, after a quick flick was released]** → A flick is chosen only when no speech had started by release, so a late report can lose a spoken request. The counters show how often a flick is followed by speech within 300 ms, and the hold-time spike tunes for it.
- **[False holds now open the microphone, not just a ring]** → The mic only listens while the pinch is held and sends nothing without speech, and the progress ring makes a hold visible before it fires. The spike measures the false-hold rate.
- **[Users used to the old rings lose their muscle memory]** → Custom layouts are kept, and binding the hold back to `action-ring` restores ring-only holds. The tools docs gain a "what moved" table.
- **[Wall, Slab and Column move to the right hand, while the two-hand demo had the left hand drawing]** → This follows Guiard: the dominant hand draws, the other hand navigates and points out. Navigation stays bindable per hand, and Dominant hand flips the rings for left-handed users.
- **[One-letter matching picks the wrong tool]** → It applies only to names of five letters or more, and to whole transcripts. The HUD names the tool picked, and Escape returns to Select.

## Migration Plan

- Load-time settings migration as in decision 5. A unit test checks that it is idempotent.
- Rollback: binding both holds to `action-ring`/`reference-ring` gives the old ring-only behaviour. Restoring the old layouts by hand in Settings > Tool rings gives the old contents.

## Open Questions

- The default `holdMs` (500, 650 or 800 ms) depends on the spike. The specs say "the hold time", so the answer changes no requirement.
