## 1. Spike and fixtures

- [x] 1.1 Spike rhino3dm on `.3dm` files (a mesh model, a Brep model, a model with blocks), in Node and in a worker; files written by rhino3dm itself, since no Rhino-saved files were at hand (files saved by Rhino are checked in 7.5):
  - confirm Brep face render meshes, Extrusion meshes, layer colours and units;
  - confirm whether block instances and their transforms can be read;
  - record the answers in `docs/import.md` and adjust the block wording in `design.md` if needed.
- [x] 1.2 `scripts/make-3dm-fixtures.mjs`: builds small `.3dm` files with rhino3dm into `test-assets/models/` (no Rhino install):
  - 3 meshes and 2 Breps;
  - a metres file with a 2 m box;
  - layers and colours;
  - 2 meshes with 4 curves and a text note;
  - a text file named `.3dm`;
  - a 2000-part grid for the render benchmark (generated on demand, not committed).
- [x] 1.3 Add `rhino3dm` (MIT) to `apps/web`; copy its WASM into `public/rhino3dm/` like the other runtimes (gitignored, fetched by the setup script); add it to `NOTICE` and the licence check.

## 2. Protocol and settings

- [x] 2.1 `packages/protocol/src/scene.ts`: the `imported` element (`asset`, `part`, `bounds`, `translation`, optional `layer` and `color`); strict validation with the element id in errors. Unit tests for valid and invalid cases.
- [x] 2.2 `packages/protocol/src/drawing-aids.ts`: `DRAWING_AIDS` (Grid, Ortho, Endpoint, Midpoint, Centre, Project, Perpendicular, each with label and description), defaults (only Grid on), `DrawingAidChoices`, `resolveDrawingAids`. `Settings.drawingAids` in `messages.ts`. Unit tests.
- [x] 2.3 Add `snapToButtons` to `FEATURES`. Unit test that the list stays consistent.
- [x] 2.4 `apps/bridge/src/settings.ts`: store `drawingAids`, merging updates so changing one never resets another. Bridge test.

## 3. Drawing aids

- [x] 3.1 `packages/scene/src/snap.ts`: `resolvePoint` for Ortho, Endpoint, Midpoint, Centre, Perpendicular, Project and Grid, with the order, tolerance and ortho-ray rules of the spec. Unit tests for every scenario, including priority, tolerance in millimetres at different zooms, and Ortho combined with a snap.
- [x] 3.2 Candidate collection for walls, slabs, columns, massings and imported bounds (bounding box corners, edges and centre, plus translation). Unit tests.
- [x] 3.3 `ToolContext`: `mmPerPixel(at)`, `aids()`, `resolve(at, anchor)`; `ToolOverlay.snap`. The viewer provides them (`Viewer.tsx`, `ToolScene.tsx`).
- [x] 3.4 Move `dragToDraw`, Column placement, Copy and Move onto `ctx.resolve`, folding `groundPoint` and the offset `snap()` into it. With only Grid on the results are unchanged; existing tool tests must pass untouched.
- [x] 3.5 Benchmark test: 2000 elements, every aid on, one point in at most 2 ms; add a spatial prefilter only if it fails.
- [x] 3.6 The marker with the aid's name, the length and angle in the notice, and the aids that are on in the status bar. Hand-press and mouse both work.
- [x] 3.7 `settings/DrawingAidsSettings.tsx`: the "Drawing aids" page (Switch rows), a `DrawingAidsStore` like `FeatureFlags`, wired in `App.tsx`; the new page in the sheet's section list.

## 4. Snap to buttons

- [x] 4.1 `input/pointer-snap.ts`: the pure per-hand state machine (capture 28 px, release 44 px, lock during a pinch, no capture while dragging or with a ring open, centre or nearest point for drawing). Unit tests for each scenario of the spec, plus a 200-control benchmark under 0.5 ms.
- [x] 4.2 `Viewer.tsx`: gather visible pressable rectangles once per frame, run the state machine per hand, publish the snapped position and outline through the existing `shown[hand]` and `markHover` paths.
- [x] 4.3 `ToolEnvironment.press` and `isButton` take the hand and use its snap state; the controller's press grab keeps the locked control for the whole pinch. Update `controller.ts`, `input-router.ts` and their tests.
- [x] 4.4 Hand overlay and pointer drawing: the pointer drawn on the snapped control (`HandOverlay`, pointer component), the control outlined. Visual baseline of a snapped pointer on the gear, light and dark.

## 5. 3DM import

- [x] 5.1 `import/rhino-worker.ts` and `import/convert.ts`: read the file, convert meshes, Brep and Extrusion render meshes, units to millimetres, layer and colour; count skipped objects by reason; enforce the 500 MB and 5 million triangle limits before anything is sent. Worker messages typed in `import/messages.ts`. Unit tests on the fixtures in Node.
- [x] 5.2 `packages/protocol` or `apps/bridge`: the `.aexmesh` container (header plus Float32 and Uint32 data), writer and reader with round-trip tests.
- [x] 5.3 `apps/bridge/src/assets.ts` and the HTTP routes in `server.ts`: `PUT` and `GET /assets/<id>`, bearer token in constant time, CORS for the allowed origins only, id validation, streamed write to a temporary file then rename, size limit, unused assets removed when a project opens. Tests: refused without a token, refused for a bad id, oversize refused, survives a restart, cleanup.
- [x] 5.4 Viewer rendering of imported elements: fetch each asset once, one mesh per part, colour, selection outline, picking, section clipping, framing the view; the bounding-box fallback for a missing asset with the status message. Measure a 2000-part model; merge per layer for display only if the frame time is over budget.
- [x] 5.5 `import/importFile.ts`: the one path used by the picker and the drop. Convert, upload, then one `scene.apply` of creates (one undo step), frame the view. A failed upload changes nothing.
- [x] 5.6 The Import button in the project bar, the window-level drop handler (also stops the browser opening the file), the drag-over message, and the report panel (imported and skipped by reason, the units read, the "Save small" hint). Hands can press the button and the report's close control.
- [x] 5.7 Move, Copy and the agent's `update` on imported elements change `translation` only; bounds, snapping and the scene read for the agent use `bounds` plus `translation` and carry no vertex data. Tests, including the agent's scene read.

## 6. Docs and roadmap

- [x] 6.1 `docs/import.md` (new: what is imported, what is skipped and why, limits, "Save small", where assets live); `docs/settings.md` (Drawing aids page, Snap to buttons); `docs/tools.md` (the aids and their order).
- [x] 6.2 Roadmap: this change becomes Week 11 and later weeks move down by one in `docs/PLAN.md`, `README.md`, the decision page and the other in-flight changes' text, as when Week 10 was added. `demos/11-precision-and-import.md` is written.

## 7. Verification

- [x] 7.1 E2E (Chromium with the fake camera, using the existing two-hands helpers):
  - `snap-buttons.spec.ts`: a near miss presses Undo and the gear; a pinch drifting 60 px still presses; two hands snap independently; no snap during an orbit; the switch off;
  - `drawing-aids.spec.ts`: each aid in the page, a wall that starts exactly on another wall's end, Ortho keeping a drag square, the status bar listing, persistence after reload;
  - `import.spec.ts`: the picker and the drop on the fixtures, the report counts, one undo, a restart keeps the model, a text file named `.3dm`, a `.png` dropped, the token required for assets.
- [x] 7.2 Visual baselines: the Drawing aids page and Features page (light and dark), a snap marker, a snapped pointer, the import report, the drag-over message.
- [x] 7.3 Latency, measured with the E2E tests and real Rhino files:
  - with Snap to buttons on, the orbit gesture-to-render p90 is within a few milliseconds of the value with it off (one frame is 16 ms, so 1 ms cannot be told apart), and under 50 ms;
  - with 1000 imported objects the orbit p90 stays under 50 ms and no main-thread task runs for a second;
  - a 43 MB, 1.3 million triangle model orbits at a p90 of 15 ms.
- [x] 7.4 Full suite, lint, typecheck, `pnpm test`, the licence check and `openspec validate --all`.
- [ ] 7.5 Demo: record the Week 11 clip from `demos/11-precision-and-import.md` ("Drop in my Rhino model, then draw a wall that snaps to its corner"), repeatable from the script in `demos/`, and fill in its real-camera checks (maintainer).
- [x] 7.6 Fix: imported models drew black (a mesh without a normal attribute is lit as facing no way, even with flat shading). Models now carry a constant normal attribute; edge lines are off for imported models (cost). Reproduced on real Rhino files; guarded by the dense-facade E2E (share of near-black pixels), with a fixture `dense-facade.3dm`.
