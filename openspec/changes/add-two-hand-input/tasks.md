## 1. Protocol and settings

- [x] 1.1 Replace `palms.stop` with `hands.stop` in `packages/protocol/src/gestures.ts`
- [x] 1.2 Per-hand gesture bindings in `packages/protocol/src/bindings.ts`:
  - `tap.left`, `tap.right`, and so on;
  - `tools-ring` / `create-ring`;
  - the `stop` slot;
  - `actionFor` and `bindingKey`;
  - `resolveBindings` reads older settings;
  - the schema accepts the legacy keys.

  Unit tests in `bindings.test.ts`.
- [x] 1.3 Add `createPalette` to the settings (`messages.ts`, `apps/bridge/src/settings.ts`), with a bridge test that it persists apart from `palette`

## 2. Recognizer

- [x] 2.1 The stop sequence in `recognizer.ts`:
  - both fists for `stop.fistsMs` arm it;
  - both palms within `stop.openMs` fire it;
  - `stopArmed` in the state.

  This replaces `stop.palmsMs` in `config.ts`.
- [x] 2.2 The two-hand start rule:
  - add `twoHand.startWindowMs`;
  - add `HandMachine.holdEmitted`, `dragging` and `pinchStartTs`;
  - a hand that holds or drags on its own keeps its gesture.
- [x] 2.3 Unit tests:
  - fists then palms fire once;
  - palms alone never fire;
  - too brief, one fist, or too late do not fire;
  - armed state;
  - a ring or drag on one hand with a tap on the other;
  - "pinch one, then the other" still makes a two-hand pinch.

  Each new test was checked to fail without the rule. `docs/gestures.md` thresholds match the config (docs test).

## 3. Two pointers across the page

- [x] 3.1 `input-bus.ts`: per-hand pointer samples and `stopArmed`; `TrackingPanel.tsx` emits every hand
- [x] 3.2 `Viewer.tsx`:
  - map hands onto the visible workspace (`handPointer`, `viewerToHand`);
  - press anything clickable anywhere on the page (`pressableAt`);
  - picking returns nothing outside the model;
  - per-hand hover outline;
  - the focus hand drives hover and the spoken "here";
  - both pointers drawn in a portal with per-hand modes and colours;
  - the "Open both hands to stop" prompt.
- [x] 3.3 Dev hooks: `__HAI_INPUT__.pointer(right, left)` and `__HAI_VIEWER__.handAt(x, y)`

## 4. Per-hand interaction and rings

- [x] 4.1 `controller.ts`:
  - per-pointer grabs (press, scroll, tool), with the tool held by one pointer at a time;
  - a press turns into a scroll after `SCROLL_SLOP`;
  - two ring layouts;
  - the palette snapshot carries its ring and hand.
- [x] 4.2 `input-router.ts`:
  - a ring per hand from the hold binding;
  - the other hand keeps working while a ring is open;
  - per-hand tap, drag and fist bindings;
  - both fists suppress fist actions;
  - `hands.stop`.
- [x] 4.3 Unit tests:
  - router: rings per hand, the other hand working, per-hand drags and taps, both-fist suppression, per-hand settings;
  - controller: the left ring picks Wall, one tool drag at a time, scroll and press-to-scroll.
- [x] 4.4 `ToolOverlays.tsx`: the ring renders by kind and hand (amber for the left); the Tool palette card has a tab per ring. Shift+Space and Shift with a held right button open the create ring.
- [x] 4.5 `GestureSettingsCard.tsx`: a select for each hand for tap, long pinch, drag and fist

## 5. Scrolling

- [x] 5.1 `apps/web/src/input/hand-scroll.ts`:
  - the content follows the hand;
  - release velocity over 100 ms;
  - an exponential coast with a 325 ms time constant;
  - grabbing catches a coast.

  Unit tests with a driven clock.

## 6. Create tools

- [x] 6.1 `apps/web/src/tools/create.ts`, with the draft overlay rendered see-through and never picked:
  - Wall (W) and Slab (F) through `dragToDraw`;
  - Column (C);
  - Copy (P).
- [x] 6.2 Default create ring layout; register the tools; move the grid snap to `grid.ts`
- [x] 6.3 Unit tests for the geometry: snapped wall ends, minimum length, counter-clockwise slab outline, column, and copy keeps the original

## 7. Docs

- [x] 7.1 Update the docs:
  - `docs/gestures.md`: vocabulary, per-hand settings, stop, thresholds;
  - `docs/tools.md`: two rings, pressing anywhere, scrolling, pointers, the create tools; its docs test checks both rings' slots;
  - `docs/navigation.md`;
  - the stop wording in `docs/agent.md` and `docs/agents.md`.
- [x] 7.2 `demos/09-two-hands.md` shot list

## 8. Verification

- [x] 8.1 E2E:
  - both pointers in their colours with a focus hand, dimmed when not engaged;
  - the left hand presses a sidebar control and takes the focus;
  - the left hand's long pinch opens the create ring, Wall draws a wall, and Undo removes it;
  - a pinch-drag scrolls the sidebar and a flick coasts;
  - the stop gesture stops a running turn;
  - per-hand gesture settings.
- [x] 8.2 Update the visual baselines for the two pointers and the create ring, then run the full suite, lint, typecheck, `pnpm test`, the licence checks and `openspec validate --all`
- [ ] 8.3 Real hands: record a short clip of both fists then open hands, and of open palms held, for a clip test (maintainer)
- [ ] 8.4 Record the Week 9 clip from `demos/09-two-hands.md` and fill in its real-camera checks (maintainer)
