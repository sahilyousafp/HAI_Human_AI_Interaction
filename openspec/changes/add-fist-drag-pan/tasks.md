# Tasks

## 1. Measure the fist on recorded footage

- [x] 1.1 Add `palmPoint(hand)` to `packages/perception/src/gestures/features.ts` (mean of the wrist and the four finger knuckles, mirrored like `pinchPoint`). Verify: a unit test in `features.test.ts` gives the expected point for a synthetic hand and the mirrored x.
- [x] 1.2 Add a throwaway script under `scripts/` that reads the recorded clips in `test-assets/landmarks`, finds the frames the posture reads as fist, and prints for the pinch point and the palm point the movement (as a fraction of the frame width) during the 100 ms before a fist forms and while it is held. Verify: the script runs with `pnpm exec tsx` and prints both numbers per clip.
- [x] 1.3 Choose the point and `clutch.moveMin` from the numbers: keep the palm point unless it is less steady than the pinch point, and set the threshold above the held-fist jitter and below a deliberate move. Record the numbers, the chosen values, and the clips in `design.md` (decisions 2 and 3). Verify: `design.md` names the measured jitter and the final threshold; if the threshold is not 0.03, the spec scenarios in `specs/gesture-recognition/spec.md` and `docs/gestures.md` are updated to match.

## 2. Recognizer: the fist drag

- [x] 2.1 Protocol: add `fist.drag.start`, `fist.drag.update` (with `delta`) and `fist.drag.end` to `packages/protocol/src/gestures.ts`, shaped like the pinch drag events. Verify: `gestures.test.ts` parses all three and rejects a missing hand.
- [x] 2.2 Config: add `clutch.moveMin` to `packages/perception/src/gestures/config.ts` and its row to the thresholds table in `docs/gestures.md`. Verify: the docs test (`docs.test.ts`) passes.
- [x] 2.3 `hand-machine.ts`: add `palm` to `HandObservation`; track a fist's start position at `clutch.start`; remember whether the hand was dragging when it closed (`clutchedFromDrag`); emit `fist.drag.start` at the clutch position once the hand moves `moveMin`, then updates; end at the first non-fist frame (and after the 250 ms loss grace). Verify: the unit tests of group 2.5 pass.
- [x] 2.4 `recognizer.ts`: pass `palmPoint` in each observation, never emit fist drags while both hands are fists (end a running one when the second hand closes), expose which hands are fists (the display already says `"clutch"`). Verify: recognizer unit tests of group 2.5 pass.
- [x] 2.5 Unit tests (`hand-machine.test.ts`, `recognizer.test.ts`), each checked to fail without its rule:
  - a fist closed at rest then moved 10% emits start, updates summing to 10%, then end, and no pinch events;
  - a still fist emits `clutch.start` and no fist drag;
  - a 1% wobble emits none;
  - opening ends the drag at the first non-fist frame, and the opening frames add no update;
  - a fist closed mid-pinch-drag and moved 20% emits no fist drag (the old reposition test keeps passing as is);
  - a 200 ms tracking loss keeps the drag, a 400 ms one ends it;
  - one hand fist-dragging, then the other closing: the drag ends and the stop still arms and fires;
  - not engaged: nothing is emitted.

  Verify: `pnpm --filter @hai/perception test` passes.

## 3. Settings: Fist drag, Fist hold

- [x] 3.1 `packages/protocol/src/bindings.ts`: add the per-hand `fistdrag` slot (`pan`, `orbit`, `none`; default `pan`) and reword the `fist` slot to "Fist hold" (close the hand and keep it still for a second and a half). Verify: `bindings.test.ts` checks the defaults for both hands, that a settings file without the new keys resolves to pan, that `fistdrag.left: "cancel"` is rejected, and that the existing `fist` choices are unchanged.
- [x] 3.2 `GestureSettingsCard.tsx`: show the Fist drag row (a select per hand, test ids `gesture-fistdrag-left` and `gesture-fistdrag-right`), light it on `fist.drag.start`, and show the new Fist hold wording. Verify: `e2e/gestures.spec.ts` gets cases for the default, a reload that keeps a change, Reset to defaults, and the row lighting up when a fist drag is injected; the existing fist tests use the same ids.
- [x] 3.3 Docs: `docs/gestures.md` (vocabulary row "Fist drag", "Fist hold", the settings table, the state diagram note that a fist drag sits inside the clutch) and `docs/settings.md`. Verify: the docs test passes and the tables match `GESTURE_SLOTS`.

## 4. Navigation: the fist drag pans

- [x] 4.1 `navigation.ts`: handle `fist.drag.start|update|end` in the branches of `pinch.drag.*` (same gain as the pan), add them to `movesCamera`, and give a fist drag no flick on release. Verify: `navigation.test.ts` covers the pan, orbit mode, and that a fast release leaves no momentum while a pinch drag still flicks.
- [x] 4.2 `input-router.ts`: route fist drags by `actionFor(bindings, "fistdrag", hand)` with that mode; call `tool.clutch(false)` on a fist drag start so the fist hold is dropped; drop fist drags while another hand navigates, a two-hand pinch runs, or a ring is open; end a running one when both hands become fists. Verify: `input-router.test.ts` has a case for each rule and for `none`.
- [x] 4.3 `controller.ts`: `FIST_RESET_MS` from 600 to 1500. Verify: `pnpm --filter @hai/web test` passes; the doc comment and `docs/tools.md` say 1.5 s.
- [x] 4.4 E2E `e2e/fist-pan.spec.ts`, using the gesture bus like `two-hands.spec.ts`:
  - a fist drag of 10% to the right moves the view 0.12 view heights to the right, with distance and angles unchanged;
  - it pans with the Wall tool active and starts no wall;
  - the drawn view follows a fast fist within 12 px and a release while moving ends where a release after resting does (no coasting, no spring);
  - a fist drag does not cancel Move after 2 s, while a still 1.5 s fist does;
  - the right hand orbiting is unaffected by the left hand's fist drag;
  - a hand whose fist drag is set to nothing stays a clutch while the other hand pans.

  Not being engaged is enforced by the recogniser before events reach the bus, so it is covered by the unit test in task 2.5, not here. Update the fist test in `e2e/tools.spec.ts` to 1.5 s (a 600 ms fist no longer resets). Verify: `pnpm exec playwright test fist-pan tools gestures` passes.
- [x] 4.5 `docs/navigation.md`: the hands table gets "Close a hand and move it: pan"; the fist-clutch row says it applies when the fist closes mid-drag; the gains table notes the fist pan uses the two-hand pan gain. Verify: the page reads right and its numbers match `navigation.ts`.

## 5. The pan pointer

- [x] 5.1 The viewer tracks, per hand, whether it is a fist (from `clutch.start` and `clutch.end`, which are already debounced) and whether its drag is panning (from the navigation it is given), clearing both on disengage. No new pointer sample field is needed. Verify: the e2e cases of 5.2 pass.
- [x] 5.2 `Viewer.tsx` and `styles.css`: add the `pan` pointer mode (four-arrow icon from the existing icon set) for a fist set to pan and for a pan-mode drag moving the view; `data-panning` fills the icon; dimmed and without the icon while not engaged; none when the hand's Fist drag is `none`. Verify: Playwright checks `data-mode="pan"` and `data-panning` on `hand-pointer-left` through the fist, the move and the opening.
- [x] 5.3 Pixel check: with the app running on the fake camera, screenshot the pan pointer unfilled and filled, on the light and dark themes and over a button and the model; check the icon is centred, readable at 28 px, and the transition does not jump. Add a case to `e2e/visual/` if the folder holds pointer screenshots. Verify: the screenshots are looked at and any glitch is fixed in `styles.css`.

## 6. Real camera and demo

- [ ] 6.1 Run the whole suite: `pnpm lint`, `pnpm test`, `pnpm exec playwright test`. Verify: no warnings, no failures; fix any, whether or not this change caused them.
- [ ] 6.2 On the real webcam: fist-pan with each hand ten times, check the status bar's "Gesture to render" p90 stays under 50 ms, and count accidental pans while moving open hands and while clutching mid-drag (target: none in 20 tries). Verify: the numbers are written into the "Check on the real camera" list of the demo script.
- [ ] 6.3 Demo: write `demos/12b-fist-pan.md` (setup, shot list, the real-camera checks, the post-recording checks, like `demos/12-3d-snapping-and-project-files.md`) for the clip "Grab the view": engage, left fist slides a building across the screen and stops where the hand stops, right hand orbits with a pinch, a still fist for 1.5 s returns the tool to Select. Verify: the script's steps all work in one take on the real camera, and the clip is listed in `docs/PLAN.md`'s clips section.
