# Tasks

## 1. Copies along a curve

- [x] 1.1 Add `stopsAlong` and `arrayAlong` to `packages/scene`: places by spacing or count, headings at corners, a width and a scale that change along the array. Verify: `along-curve.test.ts`.
- [x] 1.2 Add `geometry_array_along_curve` to the bridge's tools. Verify: `geometry-tools.test.ts` and `e2e/geometry-tools.spec.ts`.

## 2. The OpenCascade recipes

- [x] 2.1 Add `python/hai_occ.py`: loft, sweep, boolean and offset, meshed with outward faces, with plain-worded errors for what is wrong with a request. Verify: `python/test_hai_occ.py` against known volumes and outlines, run by `hai-occ.test.ts` where OpenCascade can be loaded.
- [x] 2.2 Add `GeometryKernel`, which runs a recipe as a kept script in the managed environment and reads the answer back, and says plainly when the operating system refuses OpenCascade's library. Verify: `kernel.test.ts`.
- [x] 2.3 Add `geometry_loft`, `geometry_sweep`, `geometry_boolean` and `geometry_offset`: resolve line elements and solids, store the mesh as an asset, create the model in one transaction, remove the asset if the scene refuses it. Verify: `geometry-tools.test.ts`.

## 3. Consent and access

- [x] 3.1 The four kernel tools ask before installing it, listing what would be installed, and run without asking once it is there. Verify: `python-approvals.test.ts`.
- [x] 3.2 Grant the tools to the agents that change the model; tell the agent about them; correct `python_run`'s description. Verify: `roster.test.ts`, `scene-tools.test.ts`, `python-tools.test.ts`.

## 4. Integration

- [x] 4.1 Update `docs/agent.md`; run the unit suite, Biome, tsc and the touched Playwright spec.
