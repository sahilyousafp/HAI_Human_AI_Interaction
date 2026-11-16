# Tasks

## 1. Contract

- [ ] 1.1 Add `host.edit` (transform by a 4 x 4 matrix, or delete, by ids), `host.edited` and `host.redo`, `edit` in `HostCapabilities`, and `limitTo` in `RequestContext`. Verify the schema tests.
- [ ] 1.2 Change the ring defaults and their migration (removed tools emptied, old defaults replaced). Verify "the default rings" and "a saved layout with a removed tool" in `rings.test.ts`.

## 2. Bridge and plugin

- [ ] 2.1 Relay `host.edit` to its host and `host.edited` to the pages, `host.redo` like `host.undo`, and refuse an edit for a host that cannot edit. Verify with the fake host: "move a host object by hand" (bridge side), "a refused edit", "a host without edits".
- [ ] 2.2 Apply `host.edit` in the Rhino plugin as one undo record (transform with the matrix in the document's units, or delete), and `host.redo`; fixtures and contract tests. Verify the C# tests in the container and the contract test.
- [ ] 2.3 Put the limit in the agent's text (`[limit]`), keep it with the lead's turn, and scope delegated tasks by it. Verify "ask about this" (bridge side) and "the scope follows the limit".
- [ ] 2.4 Remove the scene write tools, the geometry kernel and `context_adopt` from the bridge, with their code and tests, and from `HAI_TOOLS`, the roster, the approvals and the prompts. Verify "no scene write tools" and "the scene can still be read".

## 3. Web

- [ ] 3.1 Targets in `actedOn` (scene elements or host objects), `hostTarget` and `applyHost` in `ToolContext`, and the edit path in Move, Rotate and Delete. Verify the tool unit tests for host targets.
- [ ] 3.2 The mirror preview (`HostMirror.preview`, drawn by `MirrorLayer`), held until the host's batch, dropped on a refusal or after 5 s. Verify "no jump back" and "a refused edit" in e2e with the fake host.
- [ ] 3.3 `EditHistory`: one undo order across the scene and the hosts, for the ring, the keys and spoken undo. Verify "undo a host edit, then a scene edit" and "redo a host edit".
- [ ] 3.4 Remove the creation tools (`tools/create.ts`, massing, copy, line), their feature switch, tests and screenshots; the new rings. Verify "the default rings" in e2e and the ring screenshots, looked at.
- [ ] 3.5 Spoken commands: remove copy, array and scale; move, rotate and delete on host targets. Verify "a removed command" and "a spoken move on a host object", and the phrase set.
- [ ] 3.6 The selection card (`ComponentCard`) with Ask about this, placed beside the selection without covering a panel, and the changed objects highlighted after the request. Verify "a selected canopy", "ask about this" and "the changed objects glow" in e2e, screenshots at 1280, 1024 and 900 px in both themes, and `hud-layout.spec.ts`.

## 4. Docs

- [ ] 4.1 Update `docs/tools.md`, `docs/gestures.md`, `docs/voice.md`, `docs/hosts.md`, `docs/agent.md` and `docs/agents.md`, and add the removal of the creation tools and the geometry kernel to `docs/decisions.md`. Verify the docs test.

## 5. Demo

- [ ] 5.1 Write `demos/24-edit-surface.md` ("Edit anywhere, from HAI") and record the clip; verify on the maintainer's Rhino 8 that a move, a rotation, a delete, Undo and Redo land in Rhino as one undo step each.
