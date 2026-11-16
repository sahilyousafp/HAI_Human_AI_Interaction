# Tasks

## 1. Record the direction

- [x] 1.1 Write `docs/research/host-connectors.md` (MCP servers against code in the host for Rhino, Blender and Revit; pictures in the loop; Speckle); verify every claim has a link or is marked unverified
- [x] 1.2 Add the decision to the end of `docs/decisions.md`; verify it names what was rejected and why
- [x] 1.3 Write this change's proposal, design and the `host-orchestration` spec delta; verify `openspec validate pivot-to-host-orchestration` passes

## 2. Update the plan and the docs

- [x] 2.1 Rewrite the Decision and Architecture sections of `docs/PLAN.md` and add the new changes in order; verify no section still says agents model in HAI's scene
- [x] 2.2 Update the README's pitch, requirements and roadmap; verify the links resolve
- [x] 2.3 Update `docs/handoff.md` with the new direction and the open work in order; verify the old open items that still apply are kept
- [x] 2.4 Update the project context in `openspec/config.yaml` (hosts model, HAI views and edits, Speckle as the opt-in second exception to localhost, C# in the Rhino and Revit plugins, Python in the Blender add-on)
- [x] 2.5 Note in `openspec/changes/add-rhino-connector/tasks.md` that its open plugin tasks continue in `add-host-adapters`

## 3. Demo

- [x] 3.1 Write `demos/22-orchestration.md` (the decision, the research table, what HAI keeps, the order of the next changes); verify it reads in under 60 seconds

## 4. Next

- [x] 4.1 Specify `add-host-adapters` (proposal, design, specs, tasks) and start it
