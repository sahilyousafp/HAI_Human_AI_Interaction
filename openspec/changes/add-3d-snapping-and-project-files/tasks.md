## 1. Protocol and bridge

- [x] 1.1 `packages/protocol`: optional `base` (mm) on walls, slabs and columns (massings already have a free base), winning over the level elevation; `elementBounds` and `elementGeometry` use it. `project.create` message. Unit tests.
- [x] 1.2 `apps/bridge`: `project.create` creates the folder, writes an empty scene (one ground level) and opens it; it refuses a folder that already holds a project and says so. Bridge tests for both.

## 2. Snapping at every height

- [x] 2.1 `packages/scene/src/snap.ts`: 3D candidates (base and top for walls, columns and imported bounding boxes; slab corners at the top), screen-space matching through a `project` function, nearest-in-order, the free point on the plane at the start height for Ortho, Perpendicular and Project on 3D segments. Unit tests for every scenario of the spec, including an upper-level wall end and a rooftop corner of an imported model.
- [x] 2.2 Benchmark: 2000 elements, every aid on, projection included, at most 2 ms a move.
- [x] 2.3 `ToolContext`: `resolve` takes the screen position and returns a 3D point; the viewer provides the camera projection (`Viewer.tsx`, `pickRef.project`). Update the snap marker to draw at its height (`ToolOverlay.snap`).
- [x] 2.4 Create tools, Copy and Move place points at the snapped height: the level with that elevation, else no level and an explicit `base`; Ortho holds the plane at the start height. Existing tool tests keep passing with only Grid on.

## 3. Measure

- [x] 3.1 Measure resolves both points through the aids (surface point when nothing snaps) and shows the straight, horizontal and vertical distances; the marker shows while hovering. Unit tests, including corner to corner at two heights.

## 4. New project

- [x] 4.1 `New project` button next to Open project, with the same folder form; the scene client sends `project.create` and shows the bridge's refusal. The view frames the empty ground.
- [x] 4.2 Tests: E2E for an empty start, import into it, draw in it, and the refusal for a folder that holds a project.

## 5. Save as 3dm

- [x] 5.1 `packages/scene` `exportFootprints`: footprint, base and height for walls, slabs, columns and massings; imported parts with translation. Unit tests on exact sizes and heights.
- [x] 5.2 `apps/web/src/export/`: worker writing the file with rhino3dm (extrusions, meshes, layers by type or source layer, names and user strings, millimetres, colours) and the download; an empty project says so.
- [x] 5.3 Round-trip tests: write, read back with `convert3dm` and rhino3dm directly, check counts, layers, names, a wall's 6000 x 200 x 3000 at 4500, an imported model moved 1000 mm; saving does not change the scene. E2E: Save as 3dm downloads a file that imports again.
- [ ] 5.4 Check a saved file in Rhino 8 on the maintainer's machine (maintainer).

## 6. Docs and roadmap

- [x] 6.1 `docs/tools.md` (snapping at every height, Measure), `docs/import.md` renamed to cover import and saving, `docs/settings.md` if the project bar is described there.
- [x] 6.2 Roadmap: Week 12, later weeks move down by one (`docs/PLAN.md`, `README.md`, the decision page, the Rhino and turn-review changes). `demos/12-3d-snapping-and-project-files.md`.

## 7. Verification

- [x] 7.1 E2E with the fake camera and real models: snap to a rooftop corner of an imported fixture, a wall on an upper level, Measure corner to corner; visual baselines for the new buttons and the marker at height.
- [x] 7.2 Full suite, lint, typecheck, `pnpm test`, the licence check and `openspec validate --all`.
- [ ] 7.3 Demo: record the Week 12 clip "From a blank project to a Rhino file" from `demos/12-3d-snapping-and-project-files.md` (maintainer).
