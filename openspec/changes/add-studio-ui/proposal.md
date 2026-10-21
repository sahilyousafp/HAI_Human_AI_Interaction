## Why

AEX is filmed every week, and the interface did not look or behave like a studio:
- A permanent right sidebar held every setting and readout, and squeezed the model.
- The camera preview sat in that sidebar.
- There was no way to switch features off for a demo or a release.
- People watching a clip could not see what the user's hands were doing; they only saw a pointer.

## What Changes

- **Apple-style look:**
  - System type, frosted toolbar and panels, 8/12/16 px radii, soft shadows.
  - iOS switches, segmented controls and grouped lists.
  - Light by default, dark when the system is dark.
- **Settings sheet.** The sidebar is gone. A gear in the toolbar (and Ctrl+,) slides a settings sheet in from the right, over the model.
  - It has a first page of sections, each with its own page and a back button, as in the iOS Settings app.
  - The sections are Camera and tracking, Features, Gestures, Tool rings, Voice and Agent permissions.
  - Show my hands is a quick switch at the top.
  - Escape or the close button closes the sheet; the last page is remembered.
  - Hands can press and scroll everything in it.
- **Floating camera view.** The camera sits at the model's bottom right: the mirrored preview with the tracked points, Start / Stop, engagement, each hand's state and detection rate, and the last gesture.
  - Expand (over the model) and hide (into a Camera pill) are remembered.
  - The camera session lives as long as the page, so the camera never stops because a view closed. A hidden view keeps its video on the page, out of sight, so frames keep coming.
- **Feature switches** (Settings > Features), kept for the workspace by the bridge, each feature on until switched off. A switched-off feature leaves the interface and ignores its gestures. The features are:

  | Feature | |
  |---|---|
  | `toolRings` | Tool rings |
  | `createTools` | Create tools |
  | `twoHandNavigation` | Two-hand navigation |
  | `handScrolling` | Scroll by hand |
  | `handPress` | Press controls by hand |
  | `headGestures` | Nod and shake |
  | `stopGesture` | Stop gesture |
  | `voice` | Voice |
  | `agent` | Agent |
  | `latencyReadout` | Latency readout |

- **Show my hands** (off by default, kept for the workspace). It draws the user's hands as solid white 2.5D shapes over the whole window, each at its pointer and life-size, so people watching a recording can follow the hands.
  - Drawn from the tracked landmarks only, never the camera image.
  - Never in the way of input.
- **Hand pointers span the whole window**, so a hand can press the toolbar's gear. **BREAKING** for anything that assumed pointers stop at the model: pointer positions over the toolbar or the sheet now lie outside the viewer's 0..1 range.

## Capabilities

### New Capabilities

- `app-settings`: the settings sheet, its sections, and the feature switches and what each one gates.
- `hand-overlay`: Show my hands.

### Modified Capabilities

- `camera-tracking`: the preview becomes a floating camera view that can expand or hide, with the camera running regardless.
- `viewport-navigation`: hand pointers span the whole window.
- `tool-palette`:
  - hands press anything clickable anywhere in the window, including the settings sheet;
  - the ring layouts live in Settings > Tool rings.

## Impact

- **packages/protocol:** `features.ts` (new: the `FEATURES` list and `resolveFeatures`); `messages.ts` gains `features` and `showHands`.
- **apps/bridge:** `settings.ts` persists and merges the new settings.
- **apps/web:**
  - New:
    - `ui/controls.tsx`: `Switch`, `Segmented`, `ListGroup`, `ListRow`;
    - `settings/`: `SettingsPanel`, `FeatureSettings`, `feature-flags`;
    - `perception/tracking-session.ts`, `CameraView.tsx`, `CameraSettings.tsx`;
    - `perception/HandOverlay.tsx`, `hand-geometry.ts`;
    - `input/hand-mapping.ts`.
  - Removed: `TrackingPanel.tsx`.
  - Changed:
    - `App.tsx`, `Viewer.tsx`: feature gating, and picking only on the model's canvas;
    - `controller.ts`, `registry.ts`: tools tied to a feature;
    - `input-router.ts`: `enabled` option;
    - `ToolOverlays.tsx`, `VoiceSettingsCard.tsx`, `AgentPanel.tsx`, `styles.css`.
- **Docs:** `docs/settings.md` (new); `docs/perception.md`, `docs/tools.md`, `docs/gestures.md` and `docs/agent.md` (sidebar references); new demo `demos/10-studio-ui.md`.
- **E2E:**
  - Settings controls are reached through `openSettings(page, section)` (`e2e/settings.ts`).
  - New `e2e/studio.spec.ts` and `e2e/visual/studio.visual.spec.ts`, with the viewer baselines re-made (the model is now full width).

Demo clip (Week 10): "A studio you can film": open Settings by hand, switch Create tools off and on, turn on Show my hands, then draw a wall with the white hands visible.
