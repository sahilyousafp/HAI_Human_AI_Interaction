# Tasks

## 1. Markers in spoken commands

- [x] 1.1 Add the `moveTo` step to `packages/scene`. Verify: `transform.test.ts`.
- [x] 1.2 Teach the grammar, planner and runner "about marker X" and "move to marker X". Verify: `grammar.test.ts`, `plan.test.ts` and `e2e/spoken-commands.spec.ts`.

## 2. Named views for the agent

- [x] 2.1 Add `view` to `ViewRequest` and `set_view`, and switch the viewer. Verify: `scene-tools.test.ts` and `e2e/view-cube.spec.ts`.

## 3. Integration

- [x] 3.1 Update `docs/voice.md` and `docs/agent.md`; run the unit suite, Biome, tsc and the touched Playwright specs.
