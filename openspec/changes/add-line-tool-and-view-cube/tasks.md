# Tasks

## 1. Constraints

- [x] 1.1 Make Ortho a hard lock with an angle step (90, 45, 15) and add a length constraint in `packages/scene/src/snap.ts`. Verify: `snap.test.ts` ortho, angle step and length tests.

## 2. The line element and tool

- [x] 2.1 Add `LineElement` to the protocol and teach bounds, snapping, extrusions, geometry, move and copy, the 3dm export, the agent tools and the simulation about it. Verify: protocol, bounds, snap and export tests.
- [x] 2.2 Add the Line tool, the controller's constraints, `onAccept` for nod and Enter, and the Line spoken name; Sketch line keeps "sketch line" and "path". Verify: the Line tool tests in `tools.test.ts`.
- [x] 2.3 Add the constraints panel in the viewport's right column. Verify: `e2e/line-tool.spec.ts`.

## 3. Views

- [x] 3.1 Add `views.ts` (named views, matching, work planes) and resolve points in a side view's plane in `snap.ts`. Verify: `views.test.ts` and the side-plane tests in `snap.test.ts`.
- [x] 3.2 Add the orthographic camera, the view mode and leaving it on orbit, and the view cube. Verify: `e2e/view-cube.spec.ts`.

## 4. Integration

- [x] 4.1 Update `docs/tools.md`, `docs/navigation.md` and `docs/settings.md`; refresh the visual baselines the right column changes; run the unit suite, Biome, tsc and every touched Playwright spec one file at a time.
