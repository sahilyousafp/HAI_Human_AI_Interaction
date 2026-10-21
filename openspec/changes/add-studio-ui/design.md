## Context

The web app was a two-column grid: the model, and a 340 px sidebar. `TrackingPanel` owned the camera (`Tracker`, the stores, the video element) and rendered inside the sidebar, so unmounting it stopped the camera. Hand pointers spanned the workspace (model plus sidebar). Settings were native selects and checkboxes on flat cards.

## Goals / Non-Goals

**Goals:**
- An interface that looks good on camera and reads at phone size.
- Settings out of the way but one press away, by hand too.
- Per-feature switches for demos and releases.
- A clear view of the user's hands for viewers.

**Non-Goals:**
- Named release profiles or build-time defaults (the switches are live; profiles can come later).
- Theming beyond system light and dark.
- Drawing the camera image anywhere but the camera view.

## Decisions

**A tracking session owned by the app.**
- `TrackingSession` holds the `Tracker`, the gesture and detection stores, the recorder, the latest frame and the camera settings. It also owns its own `video` element.
- `CameraView` shows the video by moving the element into its slot. When the view hides, the video goes to a 2 px, transparent, fixed "parking" box.
- *Why parking:* a video taken off the page stops delivering frames, which a repeated E2E run caught: the tucked-away camera stopped tracking.
- Side effects (the parking box, dev hooks) happen in `connect()`, called from an effect, because React runs `useMemo` factories twice in development.

**Settings as an iOS-style sheet.**
- A narrow sheet (400 px) can't show every card at once, so the first page lists the sections, as in iOS Settings. The existing cards render inside the pages (Gestures, Tool rings, Voice and Agent permissions), and Voice is rebuilt as grouped rows with switches.
- The sheet stays mounted and is `inert` while closed, so it slides with a transform without remounting, and the hidden controls stay out of reach.

**Switches are buttons.**
- `Switch` is a `button` with `role="switch"`, so the existing hand-press path (`pressableAt`) presses it like any button, and Playwright's checked state works for tests.
- `Segmented` is a fieldset of `aria-pressed` buttons.

**Feature switches.**
- `FEATURES` in the protocol is the one list. The bridge stores only the changed choices and merges updates, so switching one never resets another.
- Gating happens where each feature acts:

  | Where | What it gates |
  |---|---|
  | The router (`enabled` option) | Rings, two-hand navigation, nod and shake, the stop |
  | The viewer's tool environment | Pressing and scrolling by hand |
  | The tool registry (`Tool.feature`, `setAvailability`) | The create tools: unavailable tools are not listed, have no shortcut, cannot be chosen, and an active one hands back to Select |
  | `App` | Voice and the agent panel |

- *Rejected:* unregistering tools, which would lose the layout slots.

**Pointers span the whole window.**
- The pointer space is `0, 0, innerWidth, innerHeight`, so the hand reaches the toolbar's gear and the sheet.
- Picking (`overHud`) now requires the point to be on the model's canvas itself, so anything floating over the model hides it from the hand.

**Show my hands.**
- A full-window canvas, fixed, `pointer-events: none`, z 55 (under the pointers at 60). It is redrawn every animation frame from `session.latestFrame`.
- `handPieces` (pure, unit-tested) anchors each hand at its pointer (`handClient(pinchPoint)`), with one scale (window height x 1.3; x times the frame aspect), mirrored.
- It returns a palm polygon (rounded by a thick outline) and tapered finger capsules, wider when nearer, ordered back to front.
- The pieces are drawn opaque white on an offscreen layer with a soft top light, then laid over the page in one pass at 0.1 opacity with a drop shadow, so overlapping fingers never show seams.

## Risks / Trade-offs

- **A full-window overlay at 60 fps.** *Mitigation:* a single drawImage per frame, and nothing is drawn when the switch is off (the canvas is not even mounted).
- **Pointers now cross the toolbar**, so a hand could press the gear or a status pill by accident. *Mitigation:* pressing needs engagement and a pinch; the status pills are not controls.
- **Settings controls are no longer always visible to tests.** *Mitigation:* a single `openSettings(page, section)` helper, and the test ids are unchanged.
