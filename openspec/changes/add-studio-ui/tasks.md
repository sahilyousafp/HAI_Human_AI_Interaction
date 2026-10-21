## 1. Protocol and settings

- [x] 1.1 `packages/protocol/src/features.ts`: `FEATURES`, `DEFAULT_FEATURES`, `FeatureChoices`, `resolveFeatures`, with unit tests
- [x] 1.2 `Settings.features` and `Settings.showHands` in `messages.ts`. The bridge `settings.ts` keeps them, merging feature choices so switching one never resets another; a bridge test checks this.

## 2. Look

- [x] 2.1 Apple-style tokens in `styles.css`:
  - system type;
  - light and dark palettes that follow the system;
  - frosted materials;
  - radius and shadow tokens;
  - hand colours;
  - the old monospace labels moved to the body font.
- [x] 2.2 `ui/controls.tsx`:
  - `Switch` (a button with the switch role, so hands press it);
  - `Segmented`;
  - `ListGroup` and `ListRow`.

## 3. Layout and camera

- [x] 3.1 `perception/tracking-session.ts`:
  - the camera session (tracker, stores, recorder, latest frame, camera settings) owned by the app;
  - `connect()` after mount;
  - the video parked on the page while no view shows it.
- [x] 3.2 `perception/CameraView.tsx`: the floating camera view (preview and points, Start / Stop, engagement, hand states and detection rate, last gesture), with expand and hide remembered
- [x] 3.3 `perception/CameraSettings.tsx`: the camera page of the settings. `TrackingPanel.tsx` is removed.
- [x] 3.4 `App.tsx`:
  - no sidebar;
  - a frosted toolbar with the settings gear (Ctrl+,);
  - picking only on the model's canvas;
  - the section readout moved to bottom centre.

## 4. Settings sheet

- [x] 4.1 `settings/SettingsPanel.tsx`:
  - a sheet sliding from the right;
  - a first page of sections, each with a page and Back;
  - Escape and the close button;
  - the last page remembered;
  - `inert` while closed.
- [x] 4.2 Pages:
  - Camera and tracking;
  - Features (`settings/FeatureSettings.tsx`);
  - Gestures;
  - Tool rings (a segmented ring choice);
  - Voice, rebuilt as grouped rows with switches;
  - Agent permissions.

  Show my hands is at the top of the first page.

## 5. Feature switches

- [x] 5.1 `settings/feature-flags.ts`: the client store
- [x] 5.2 Gating:
  - router `enabled`: rings, two-hand, nod and shake, stop;
  - the viewer: pressing and scrolling by hand, keyboard and mouse rings, latency readout;
  - the registry: `Tool.feature` and `setAvailability` for the create tools, with an active one handing back to Select;
  - `App`: voice and agent.
- [x] 5.3 Unit tests: the router ignores switched-off gestures; the create ring needs the create tools; the registry hides and refuses unavailable tools and hands back to Select

## 6. Show my hands

- [x] 6.1 `perception/hand-geometry.ts`:
  - each hand anchored at its pointer, at one scale, mirrored;
  - a rounded palm and tapered, depth-scaled fingers, back to front.

  Unit tests.
- [x] 6.2 `perception/HandOverlay.tsx`:
  - a full-window, click-through canvas under the pointers;
  - one even white layer with a soft top light;
  - laid over at 0.1 opacity with a shadow;
  - drawn only while on.
- [x] 6.3 Pointers span the whole window (`input/hand-mapping.ts`, `pointerSpace`), so hands reach the toolbar's gear

## 7. Docs and roadmap

- [x] 7.1 `docs/settings.md` (new). Sidebar references updated in `docs/perception.md`, `docs/tools.md`, `docs/gestures.md` and `docs/agent.md`.
- [x] 7.2 Week 10 added and later weeks renumbered: `docs/PLAN.md`, `README.md`, the decision page, the Rhino and turn-review changes, and the demo 09 teaser. `demos/10-studio-ui.md` is written.

## 8. Verification

- [x] 8.1 E2E:
  - `openSettings` helper; existing specs open the settings where their controls moved;
  - `studio.spec.ts`: sheet open and close, Create tools off everywhere and after a reload, agent off, Show my hands drawn at the pointer and click-through;
  - `two-hands.spec.ts`: the gear and a feature switch pressed by hand, the settings scrolled by hand;
  - camera view: placement, expand, hide while still tracking, settings never stopping the camera.
- [x] 8.2 Visual baselines: the settings (light and dark), the Features page, the camera view and Show my hands, with the existing baselines re-made for the full-width model
- [x] 8.3 Full suite, lint, typecheck, `pnpm test`, the licence check and `openspec validate --all`
- [ ] 8.4 Record the Week 10 clip from `demos/10-studio-ui.md` and fill in its real-camera checks (maintainer)
