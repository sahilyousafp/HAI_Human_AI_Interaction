# Tasks

## 1. Settings, bindings and the new ring layouts

- [x] 1.1 In `packages/protocol`, add the binding value `talk`, read `tools-ring`/`create-ring` as `action-ring`/`reference-ring`, add `dominantHand` to `Settings`, and set the new default layouts and hold bindings; verify schema unit tests accept the new values and reject an unknown hand
- [x] 1.2 Write the pure migration (an old default layout becomes the new one, the old default hold pair becomes `talk`/`talk`, everything else is kept) and run it from `apps/bridge/src/settings.ts` on load; verify the unit tests "Old default layout is replaced" and "Custom layout is kept", and that running the migration twice gives the same result
- [x] 1.3 Add `spoken: string[]` to `Tool` (defaulting to the lower-cased label) with spoken names for every built-in tool, and show the first one under each ring slot's icon; verify the registry unit test "Registered tool appears in settings", and Playwright screenshot baselines of both rings in light and dark
- [x] 1.4 Rename the rings in Settings > Tool rings (Action ring, Reference ring) and add the Dominant hand control, persisted by the bridge; verify E2E "Setting persists" and "Layout persists", and that the reference ring keeps its own layout after a reload

## 2. Reference tools: Sketch line, Sketch area, Place marker

- [x] 2.1 Implement Sketch line and Sketch area in `apps/web/src/tools/reference.ts`: drawing through the aids, simplification at 100 mm, the minimum sizes, dashed overlay in the hand's colour with S labels, and at most 8 kept; verify unit tests for simplification and the minimums, and the E2E scenarios "Draw a path", "Too short" and "Outline a courtyard" with the fake camera
- [x] 2.2 Clear sketches on Escape and when a request is sent, and remove one with Delete without confirmation; verify E2E "A request clears sketches" and "Delete one sketch"
- [x] 2.3 Add marker storage in the bridge (`.hai/markers.json`, a `markers.set` message, broadcast to every viewer) and the Place marker tool (first free letter, a tap on a marker removes it); verify bridge tests for storage and restart, and E2E "Two markers", "Markers survive a restart" and "Letters are reused"
- [x] 2.4 Add the shortcuts L, E and K, and document the three tools and the new ring defaults (with a "what moved" table) in `docs/tools.md`; verify E2E "Shortcut chooses a tool" (E) and that the `docs.test.ts` checks of `docs/tools.md` pass

## 3. References reach the agent

- [x] 3.1 Extend the request message and the context block with `target`, `points`, `sketches` and `markers`, and return the same from `get_user_context`; verify protocol schema tests, and bridge tests with the fake agent CLI for "A sketch reaches the agent" and "Markers are always included"
- [x] 3.2 Tell the agents' shared instructions that "this", "here" and "there" refer to the target, the points P1 to Pn, the sketches S1 to Sn and markers by letter; verify the bridge test that checks the written agent files contain the reference rules, and run one real Claude Code turn ("a wall along S1") with the result noted in the task log
  - Live run 2026-10-26 (`e2e/hold-to-talk-live.spec.ts`, Claude Code 2.1.310): "Architect, a wall along S1" with S1 from (22000, 3000) to (30000, 3000) mm gave a wall from (22000, 3000) to (30000, 3000), in 1.1 min.

## 4. Spoken tool names without the agent

- [x] 4.1 Implement `apps/web/src/voice/tool-commands.ts` (normalise, strip "use"/"tool", whole-transcript match, one letter of difference from five letters, reusing the helper from `agent/addressing.ts`) and call it before agent addressing; verify unit tests for match, near miss, too-short names and a longer sentence
- [x] 4.2 Wire a match to choose the tool or run an instant tool, with a HUD notice naming it and no countdown; verify E2E with recorded utterances "Say a tool name" (within 300 ms of the utterance ending), "Instant tool by voice", "Near miss within one letter", "A longer request goes to the agent" and "Registered tool can be spoken"
- [x] 4.3 Document spoken tool names in `docs/voice.md`, including how a plugin tool declares them; verify the `docs.test.ts` checks of `docs/voice.md` pass

## 5. The hold machine: talk, then ring, then flick

- [x] 5.1 Write the per-hand hold state machine as a pure class (idle, held, speaking, flicking, ring shown) with injected events and clock; verify unit tests for each release outcome, "Speech wins over a flick", "Silent flick picks a tool" and the 600 ms ring fade
- [x] 5.2 Lock the target when the hold fires (element, else a snap through the aids, else the ground) and show it; verify unit tests for each kind, and E2E "Hold on a wall", "Hold on empty ground" and "Hold near a wall end"
- [x] 5.3 Integrate the machine into `input-router.ts` for `talk` bindings, keeping holds on controls and on held objects as before, and ring-only bindings opening at once; verify E2E "Palette opens", "The left hand opens the reference ring", "A binding opens a ring at once", "Holding a grabbed object keeps holding it" and "Hold on a control presses it"
- [x] 5.4 Draw the progress ring during the hold and the transcript chip beside the hand (Listening, the live transcript, "Sent - shake to stop"); verify Playwright screenshot baselines in light and dark at 1280 and 1920 px wide, with no overlap with the HUD
- [x] 5.5 Apply Dominant hand to which ring each `talk` hold falls back to; verify E2E "Left-handed user"

## 6. Listening while held, and sending on release

- [x] 6.1 Start the listener with silence ending off when the hold fires (preloading VAD at first engagement), and on release call `finish()`; drop silent holds; verify E2E with the fake microphone "Listening from a held pinch", "Release ends listening" (Mic off within 100 ms), "Silent hold sends nothing" and "A pause during a held pinch", and that mic live comes within 150 ms of the hold firing
- [x] 6.2 Send held transcripts on release without the countdown, through agent addressing, and give "shake to stop" priority for 1.5 s; verify bridge and E2E "Held request is sent on release" (within 100 ms), "Shake stops a sent request" and "Addressing still works"
- [x] 6.3 Capture points the hand rests on for 300 ms while speaking, through the aids, with P markers; verify unit tests in `utterance-context.test.ts`, and E2E "Copy this there", "Passing over is not captured" and "Held target and points"
- [x] 6.4 Document hold to talk in `docs/gestures.md` and `docs/voice.md` (the binding, the ring fallback, Dominant hand, how to get the old rings back); verify the `docs.test.ts` checks pass and every gesture listed is in the demo script

## 6b. Long pinch by role

- [x] 6b.1 Default the long pinch by role (the dominant hand's action ring at once, the other hand's hold to talk), store only changed bindings so defaults follow the Dominant hand setting, and migrate the first cut's talk on both hands once (`holdRoles`); verify `bindings.test.ts`, `rings.test.ts`, `gesture-settings.test.ts`, `input-router.test.ts`, and E2E "The dominant hand opens its ring at once" and the left-hand hold to talk cases in `hold-to-talk.spec.ts`

## 7. Counters and the hold-time spike

- [x] 7.1 Add the hold counters to the HUD Detection card; verify E2E "Counts update", and "Counts stay local" by asserting no request leaves 127.0.0.1 during a held session
- [ ] 7.2 Spike on the reference laptop with the real camera and microphone: twenty minutes of normal use at `holdMs` 500, 650 and 800, recording false holds, time from hold to first speech and flick-then-speech races from the counters; record the numbers and the chosen default in `docs/decisions.md`, and set the default in `packages/perception/src/gestures/config.ts` and `docs/gestures.md`; verify the gesture unit tests pass with the new value

## 8. Integration and demo

- [x] 8.1 Run the full unit suite, Biome, and every Playwright spec touched by this change, one file at a time; verify everything is green with no new warnings and no flaky retries
- [ ] 8.2 Write `demos/20-hold-to-talk.md` ("Point, hold, speak", about 45 s): hold on a wall and say "make this 300 thick"; silently flick the left hand to Sketch area and outline a courtyard; hold and say "Architect, a canopy over this"; say "measure"; end on switching Dominant hand. Add the week to `docs/PLAN.md`, and record the clip; verify the script runs end to end on the reference laptop against the real Claude Code

## Workflow follow-up

- Archive `add-two-hand-input`, `add-studio-ui`, `add-precision-aids-and-3dm-import` and `add-fist-drag-pan` before archiving this change, because its tool-palette deltas modify requirements they introduce.
