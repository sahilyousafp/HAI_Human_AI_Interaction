# Design

## Context

- `packages/scene/src/snap.ts` (from `add-precision-aids-and-3dm-import`) matches a point on the horizontal ground plane (`ctx.ground(at, 0)`) against the plan positions of other elements, with a tolerance of 24 px converted to millimetres at the pointer (`mmPerPixel`). It returns a 2D point. Every create tool then builds its element on the ground level (`groundLevel` in `tools/create.ts`).
- That is why it fails above the ground: a wall end at 4500 mm appears on screen where the ray meets the ground a long way from its plan position. Imported models make this obvious (rooftops).
- Measure (`tools/builtin.ts`) takes `ctx.pick(at).point`, the exact surface point, and never calls the resolver.
- `openProject` (`apps/bridge/src/project.ts`) seeds the sample scene when a folder has no scene file; there is no empty project. `rhino3dm` can write files (`File3dm`, `Extrusion.create`, `addMesh`, `toByteArray`), proven by `scripts/make-3dm-fixtures.mjs`.

## Goals / Non-Goals

**Goals:**
- One resolver for every tool, matching on screen, at any height.
- A saved `.3dm` that Rhino users can edit: native extrusions, real heights, real names.

**Non-Goals:**
- Snapping to mesh surfaces or to the underside and hidden faces of imported models beyond their bounding box.
- Round-trip sync with Rhino (that is the connector, later).

## Decisions

**Snap in screen space, in 3D.**
- `SnapIndex` stores 3D points (`[x, y, z]`) and 3D segments. `resolvePoint` receives a `project(point3) => [px, py]` function and the pointer's screen position instead of a ground point and `mmPerPixel`. A candidate is within reach when its projected position is within 24 px of the pointer; the nearest in the aid order wins. Perpendicular and Project use the nearest point on a 3D segment to the pointer ray (found by projecting the segment to the screen and taking the closest screen point, then mapping the parameter back to 3D).
- Ortho stays in plan, in the plane at the start point's height; the free point of a drag is the ray's intersection with that plane (`ctx.ground(at, startHeight)`), so a line begun on a roof stays level. Grid snaps in plan too.
- Cost: candidates are projected per move; a prefilter on the screen-space bounding box of the pointer's reach keeps this under 2 ms for 2000 elements (benchmark kept from the earlier change, now with projection).
- *Rejected:* keeping plan matching and adding a "current level" setting (the user would have to switch levels by hand; imported models have no levels); ray-casting the model for a height first (hits the wrong surface for hidden corners, and costs a pick per move).

**Height and level of a new element.**
- `ctx.resolve` returns `point: [x, y, z]`. A tool that starts at a snapped point takes `z` as its base: the level with that elevation if there is one (within 1 mm), else no level and a base at `z`. Elements already support an optional `level` and base heights come from the level elevation; a missing level needs an explicit base, so walls, slabs and columns gain an optional `base` height in millimetres that wins over the level (default 0). This is the one schema change.
- *Rejected:* creating a new level for every height (it clutters the model and the user did not ask for levels).

**Measure goes through the resolver.**
- First and second points call `ctx.resolve` with the aids; with no snap in reach the surface hit point is kept. The overlay already carries 3D measure points.

**New project is a bridge message.**
- `project.create { path }` on the WebSocket: the bridge creates the folder, writes an empty scene (`levels: [ground]`, no elements) and opens it, refusing when `scene.aex.json` already exists. `openProject` keeps seeding the sample for the first launch only (no stored project), so existing behaviour and tests stay.
- The button reuses the folder-path form of Open project.
- *Rejected:* an "empty" flag on `project.open` (a typo in a path would silently create a project).

**Save as 3dm is built in the browser, in a worker.**
- A pure builder in `packages/scene` (`exportFootprints`) turns each element into `{ footprint polygon, base, height }` (walls: the rectangle around the baseline; slabs: the outline, going down from the top; columns and massings: rectangles) or a mesh part (imported: asset triangles plus translation). A worker in `apps/web/src/export/` loads rhino3dm, creates `Extrusion.create(polylineCurve, height, true)` at the base height, sets layer, name and user strings, adds meshes, and returns `toByteArray()`; the page offers it as a download. The imported asset is read from the bridge through `ModelAssets`.
- Units are set to millimetres on the file; levels are not exported as Rhino objects (their names are kept as a user string on each element).
- *Rejected:* exporting everything as meshes (not editable in Rhino); exporting on the bridge (the bridge would need the WASM and the browser already has it); writing the file into the project folder (a download is what "save as" means to the user and needs no path).

## Risks / Trade-offs

- [Candidates at both base and top double the points] → the screen prefilter keeps cost flat; measured by the benchmark.
- [Snapping to a hidden corner can surprise] → the marker and label show it; Project/Endpoint can be switched off.
- [`base` on elements changes the schema] → optional with a default, so every existing scene opens unchanged; older builds reject scenes that use it (strict schema), which the migration note covers.
- [Extrusion of a slab outline with many points or holes] → outlines are simple closed polygons in this model, so one polyline extrusion is exact.

## Migration Plan

- Archive `add-precision-aids-and-3dm-import` first (this change adds to `drawing-aids`, which that change creates).
- Scenes without `base` open as before. Rollback is hiding the two buttons and ignoring `base`.
- Roadmap: this becomes Week 12; the Rhino connector and later weeks move down by one.

## Open Questions

- None that change the specs: the folder for a new project is entered like Open project's.
