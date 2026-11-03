# Tasks

## 1. One pinch, one point

- [x] 1.1 A hand's pinch places the previewed point, with no orbit, and gives way to a long pinch. Verify: `e2e/line-tool.spec.ts`, `input-router.test.ts`.
- [x] 1.2 The hand that started a line steers it; the other hand orbits. Verify: `e2e/line-tool.spec.ts`.
- [x] 1.3 Keep a hand's snap and Ortho angle against jitter. Verify: `snap.test.ts`.
- [x] 1.4 Ortho for Line, on by default. Verify: `e2e/line-tool.spec.ts`, `drawing-aids.test.ts`.

## 2. Undo, edit points, Freeform

- [ ] 2.1 Undo and Redo go to the active tool first, from every entry point; Undo point and Finish in the panel. Verify: `e2e/line-tool.spec.ts`.
- [ ] 2.2 Pick a thin line within reach on screen. Verify: `e2e/line-tool.spec.ts`.
- [ ] 2.3 Point handles: Move drags one and Delete removes one. Verify: `line-edit.test.ts`, `e2e/line-tool.spec.ts`.
- [ ] 2.4 The Straight / Freeform toggle. Verify: `e2e/line-tool.spec.ts`.

## 3. Groups, selection, Rotate

- [ ] 3.1 `hai.group` and `packages/scene/src/groups.ts`; selection expands to whole groups. Verify: `groups.test.ts`.
- [ ] 3.2 Move, Copy and Delete act on the whole selection. Verify: `tools.test.ts`, `e2e/groups.spec.ts`.
- [ ] 3.3 The Rotate tool. Verify: `e2e/groups.spec.ts`.
- [ ] 3.4 An import is one group. Verify: `importer.test.ts`, `e2e/import.spec.ts`.
- [ ] 3.5 Publish layouts for the options panel for the owner to pick from, then build the chosen one. Verify: `e2e/groups.spec.ts`, `e2e/hud-layout.spec.ts`, screenshots at 1280, 1024 and 900 px.

## 4. Agents and voice

- [ ] 4.1 Pointing at part of a selection means the whole selection; "group this" and "ungroup". Verify: `utterance-context.test.ts`, `phrases.test.ts`, `e2e/spoken-commands.spec.ts`.
- [ ] 4.2 A request about several elements groups them and names the group. Verify: `e2e/agent.spec.ts`.
- [ ] 4.3 `group_elements`, `ungroup_elements`, whole groups in `transform_elements`, and the refusal in `update_elements`. Verify: bridge unit tests.
