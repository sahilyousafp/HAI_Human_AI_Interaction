# Design

## Context

See proposal.md - Why. Where the code stands:

- `hand-machine.ts` already recognises a fist (after `clutch.debounceMs`, 100 ms), ends any drag silently, emits `clutch.start`, and returns early for every fist frame. It tracks no position while a hand is a fist.
- The fist action (cancel, back to Select, by default) is a browser timer in `controller.ts` (`FIST_RESET_MS` = 600), started by `clutch.start` and cleared by `clutch.end`. The router suppresses it while both hands are fists (the stop gesture).
- One-hand pinch drags reach navigation through the router (`owners`), which sends `pinch.drag.*` events and a `dragMode` ("orbit" or "pan") to `navigate()`. Pan mode already exists and uses the two-hand gain (1.2). Flicks coast through `fling`/`coast`.
- Hand pointers are DOM elements in `Viewer.tsx` (`pointerLook` gives a `data-mode` and an optional icon). The pointer sample from the tracking panel carries the hand points and `closing`, not which hands are fists; the viewer does receive every gesture.
- This change builds on the code of `add-two-hand-input` (still open, so its spec deltas are not yet in `openspec/specs/`). It touches none of the requirements that change modifies, only adds to them.

## Goals / Non-Goals

**Goals:**
- A fist carries a deliberate move without ever turning into a cancel or a tool action.
- Reuse the existing pan navigation path (gain, flick, coasting) instead of a second one.
- Keep the clutch (reposition mid-drag) and the two-fists stop working exactly as now.
- Everything is testable from recorded landmark frames: no human needed.

**Non-Goals:**
- A new pan algorithm, a pan gain setting, or a two-hand fist gesture.
- Moving the fist-hold timer out of the browser (it stays where it is, see below).

## Decisions

**1. New events `fist.drag.start|update|end`, next to the clutch events.**
- They are shaped like `pinch.drag.*` (a `position`, a `delta` on updates) so the router and `navigate()` treat them alike.
- `clutch.start` and `clutch.end` are unchanged and still bracket the fist. A fist drag always sits inside one.
- Rejected: reusing `pinch.drag.*` for fists (consumers could not tell a fist from a pinch, and the Gestures card could not light two rows); adding positions to the clutch events (they would carry a stream of updates under a "start/end" name).

**2. A fist drag starts only from a fist closed at rest, then moved 3% of the image width.**
- The hand machine records the hand point at `clutch.start` and emits `fist.drag.start` at that point once the hand has moved `clutch.moveMin` (0.03, measured like `pinch.tapMaxMove`: a fraction of the frame width, aspect corrected). The first update then carries the movement since the start, so the threshold costs no distance.
- If the hand was dragging when it closed (the machine's `dragStarted` at the moment of the fist), the fist is a pure clutch until it opens. Without this rule the old "move your hand back while the view stays put" gesture would turn into a pan, which is a regression for anyone who clutches to reposition.
- 3% matches the pinch's own tap-vs-drag threshold, so both gestures feel alike. It is a first value to confirm on the recorded clips (task 1.3), not a final one.
- Rejected: any movement of a fist pans (the fist forming moves the hand, and tracking jitter would creep the view); a dwell before panning (adds the latency the fist already pays: 100 ms debounce).

**3. The fist's position is the palm, not the pinch point.**
- `pinchPoint` is the midpoint of the thumb and index tips. Those tips travel toward the palm as the fingers curl, so while a hand closes it would read as a move of several percent of the frame.
- A new `palmPoint` (the mean of the wrist and the four finger knuckles, mirrored like `pinchPoint`) stays put while the fingers curl. The tracked fist drag uses it.
- Measured on the recorded clips (`two-hands`, `one-hand-pinch`, `open-palm`: four fists, 4-11 frames each, so a small sample), as the largest movement from the first frame, in fractions of the frame width:

  | Point | While the hand closes (300 ms to the fist) | While the fist is held (after 100 ms) |
  |---|---|---|
  | Pinch point (thumb and index tips) | 0.076 to 0.102 | 0.007 to 0.036 |
  | Palm point | 0.009 to 0.014 | 0.003 to 0.009 |

  The palm point is 6 to 8 times steadier while closing, and its held jitter is a third of the 3% threshold (decision 2), which is kept at 0.03. The pinch point would fake a pan on its own (closing) and would pass the threshold while held. `features.test.ts` pins these numbers against the clips.
- Rejected: the fingertip centroid (moves as the hand closes); the wrist alone (tracked less reliably and turns with the forearm).

**4. The fist drag ends on the first non-fist frame, not after the 100 ms debounce.**
- A hand opening moves and changes the landmarks. Ending the drag at the first frame that stops being a fist keeps that noise out of the flick measured over the last 100 ms. `clutch.end` still follows after its debounce, unchanged.
- A hand lost for less than `pinch.lostGraceMs` (250 ms) keeps its fist drag, like a pinch.

**5. Routing: fist drags go to navigation, per hand, with the hand's own mode.**
- The router asks `actionFor(bindings, "fistdrag", hand)`. `pan` and `orbit` send the events to `navigation(event, mode)`; `none` ignores them.
- `navigate()` handles `fist.drag.start|update|end` in the same branches as `pinch.drag.*`, so flick and coasting are shared. `movesCamera` includes them for the latency stamp.
- A fist drag is dropped (no owner) if another hand is already navigating, a two-hand pinch is active, or this hand's partner holds a ring open. Navigation state (`NavigationInput`) is shared, so two moving hands would fight over `samples` and `momentum`.
- When the second hand closes into a fist, the recogniser ends a running fist drag at once (it knows both postures; the router only learns of the second fist after its 100 ms debounce) and the hand stays a pure clutch until it opens. The router also drops a fist drag that starts while it knows both hands are fists.
- Rejected: letting both hands pan at once (the sum of two hands is not a gesture anyone can predict).

**6. Cancel by fist: the same browser timer, 1.5 s, cleared by a fist drag.**
- `FIST_RESET_MS` goes from 600 to 1500. The router calls `tool.clutch(false)` when a fist drag starts, which clears the timer, so a moving fist never cancels. A still fist, including normal tracking jitter under 3%, still runs the action.
- Why not move the timer into perception: it is a change in where a behaviour lives, with no new capability for the user, and the existing end-to-end tests exercise the timer as it is. The fist hold stays a browser timer started by `clutch.start`; this change only lengthens it and lets a fist drag cancel it.
- Rejected: a shorter hold with a bigger move threshold (cancel and pan would compete for the same small movements); making the length a setting (one more knob to explain, and 1.5 s is the maintainer's chosen value).

**7. Settings: a new per-hand `fistdrag` slot; `fist` keeps its key.**
- `fistdrag.left` and `fistdrag.right` offer `pan`, `orbit` and `none`; the default is `pan`. `GESTURE_SLOTS.fist` keeps its key and actions and only changes its label ("Fist hold") and how-to text, so stored settings and the `gesture-fist-*` test ids keep working.
- The settings schema already accepts any subset of keys, so older files load unchanged and get the default.
- Rejected: folding the drag into the `fist` slot as extra actions (one dropdown cannot say "hold does cancel, drag does pan"); a global on/off in Settings > Features (the per-hand `none` already switches it off, and Features is for whole capabilities).

**8. The pan pointer.**
- The viewer already receives every gesture, so it keeps per hand whether it is a fist (`clutch.start` and `clutch.end`, already debounced) and whether its drag is panning (the navigation it is handed, in pan mode); disengaging clears both. The pointer sample carries nothing new.
- `pointerLook` gets a `pan` mode: a fist whose `fistdrag` is `pan`, or any hand whose drag is moving the view in pan mode. The pointer shows the four-arrow icon from the same icon set as the tool glyphs; `data-panning="true"` fills it while the view moves. A hand set to `none` shows no icon.
- Rejected: changing the browser mouse cursor (the hands do not use it, and it is a separate concern, see proposal.md - Out of scope); a text hint in the HUD (the pointer is where the eye already is).

## Latency budget

Panning must not wait for anything else: it runs entirely in the browser, like orbit. Budget: gesture-to-render p90 under 50 ms on the reference laptop, which the status bar's existing "Gesture to render" readout measures. The fist drag adds the 100 ms debounce before it can start (the fist must be recognised first), so the budget applies from the first update after the start. Task 6.2 checks the readout while fist-panning.

## Risks / Trade-offs

- **A fist is easy to confuse with a bad pinch** (the existing note in `docs/gestures.md`: on recorded footage the two shapes are close). A hand that half-closes could pan the view. → The fist posture requires all four fingers curled (it is already stricter than the pinch), the drag needs 100 ms of fist plus 3% of movement, and Fist drag can be set to nothing per hand. Measured on the recorded clips in task 1.3.
- **Hand opening noise** could add a false flick. → Decision 4 ends the drag at the first non-fist frame, and tests feed a recorded opening.
- **A longer hold (1.5 s) makes the cancel fist slower** when the user means it. → Intended by the proposal; the head shake and Escape still cancel at once.
- **Mixed hands:** a fist drag on one hand and a pinch drag on the other are dropped, not combined (decision 5). A user who tries both at once sees only the first one move the view. → Documented in `docs/navigation.md`.
- **Fatigue:** a raised fist moving for long is as tiring as any mid-air gesture. → Coasting after a flick lets a short move cover a long distance.

## Migration

None. Settings files from before this change load unchanged (the new keys are optional and default to pan). There is no data to convert and nothing to roll back beyond reverting the change; the one behaviour users can notice is the longer fist hold (600 ms to 1.5 s).
