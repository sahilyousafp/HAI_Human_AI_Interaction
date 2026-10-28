# Tasks

## 1. Rotation, scale and one transform module

- [x] 1.1 Add `rotationDeg` to massing, columns and imported models and `scale` to imported models; teach bounds, snapping, extrusions, the viewer, the Rhino export and the simulation geometry about them. Verify: `transform.test.ts`, `bounds.test.ts` and the export and simulation tests.
- [x] 1.2 Add `transformPatch` and `applySteps` to `packages/scene`, and make Move and Copy use them. Verify: `transform.test.ts` and the tool tests.
- [x] 1.3 Add `transform_elements` to the agent's tools, with copies. Verify: `scene-tools.test.ts`.

## 2. The command grammar

- [x] 2.1 Add the grammar (numbers in words and digits, units, directions, chaining, all-or-nothing). Verify: `grammar.test.ts`.
- [x] 2.2 Add the planner and the runner (this or the selection, one undo step, delete asks, hide and isolate). Verify: `plan.test.ts` and `run.test.ts`.
- [x] 2.3 Wire the grammar into the voice input's `command` hook, the visibility store into the viewer and snapping, and the feedback into the voice bar. Verify: `e2e/spoken-commands.spec.ts`.

## 3. Claude chat off

- [x] 3.1 Rename the Agent feature to Claude chat; with it off, no chat panel, no name listening, "Not a command" for what is not one, and the command strip over the model. Verify: `e2e/spoken-commands.spec.ts`.

## 4. Integration

- [x] 4.1 Update `docs/voice.md`, `docs/settings.md` and `docs/agent.md`; run the unit suite, Biome, tsc and every touched Playwright spec one file at a time.
