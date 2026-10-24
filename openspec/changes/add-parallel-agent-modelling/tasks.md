# Tasks

## 1. Tags, owners and queries (ends with: agents see and filter the model by owner and part)

- [ ] 1.1 Add the optional `tags` field to every element in `packages/protocol` (name 64, value 200, at most 20, `hai.` reserved) and keep old files loading; verify "Tags survive saving", "Old project loads" and "Invalid tag is rejected" in unit tests
- [ ] 1.2 Add `set_tags` to the scene tools (own tags only, reserved names refused) and stamp `hai.owner` and `hai.part` on elements an agent creates; verify "Created elements are stamped" and "Reserved names belong to the system" through the MCP client
- [ ] 1.3 Make id collisions explain themselves (the refusal names the owner) and keep generated ids unique; verify "Two agents pick the same id" and "No id given"
- [ ] 1.4 Add owner, part and tag filters to `get_elements`, counts by owner and part to `get_scene_summary`, and tags to element details; verify "Filter by part", "Ask what a part holds" and "Summary by owner"
- [ ] 1.5 Include the Rhino objects' `hai.*` tags in the same queries while Rhino is connected (listing from the mirror table, not a script); verify with the fake Rhino client that one question returns both
- [ ] 1.6 Make the importer record `hai.source` (file name and object id) on each element it creates and leave it off grouped elements; verify "Source recorded" with the real importer on a fixture

## 2. Per-agent undo groups and authors (ends with: two agents' edits are two undo steps)

- [ ] 2.1 Replace the single open group in `SceneStore` with a group per agent, committing each edit with that agent's label; verify "Two agents, two steps" in store tests with interleaved edits
- [ ] 2.2 Add `by` to `scene.patch` and keep it in the web scene client's `lastChange`; verify "Author on every change" and that older clients ignore nothing they need
- [ ] 2.3 Make user undo flush every open group in order of last activity, reopen them empty and undo the newest; verify "Undo while agents work" and that the single-agent tests still pass unchanged
- [ ] 2.4 Property test: two agents changing disjoint elements in any interleaving, then undoing both in either order, returns the original scene

## 3. Claims and scheduling (ends with: two writers with disjoint scopes run at the same time with the fake CLI)

- [ ] 3.1 Add the claim table (ids, part, region scopes; overlap, membership and holder queries; a task without scope claims everything); verify overlap and membership cases in unit tests, and the 5 ms p90 budget for 100 elements in a 5000-element model
- [ ] 3.2 Add `scope` to `TeamTask` and the delegate tool, and the shared brief (set once per request, prefaced to each task, readable by every agent); verify "Scoped hand-offs", "No scope", "Brief reaches every task" and "Overlap warned"
- [ ] 3.3 Change `Team.schedule` to run writers with disjoint claims together, record `waitingFor` on a queued task, and keep the old rule when the feature is off; verify "Disjoint writers run together", "Overlapping scopes queue", "Switch off" and the existing scheduler tests
- [ ] 3.4 Release the claim in `finish()`, `stopAll` and project switch before rescheduling; verify "Stopped task frees its scope" and that a queued task cancelled never holds a claim, with failure and crash paths
- [ ] 3.5 Pass the calling agent into the store through a small interface that resolves its active task; refuse unclaimed create, update, delete and tag changes as a whole batch with the holder named; verify "Touching another agent's wall", "Creating outside the scope", "One bad element in a batch" and "Late call after the task" through the MCP client with two tokens
- [ ] 3.6 Let the user's edits through and tell the owning agent at its next read (`changedByUser`); verify "The user overrides"
- [ ] 3.7 Add `get_claims`, `request_claim` and `release_claim` for every agent; verify "Read claims", "Extension granted" and "Extension refused"
- [ ] 3.8 Update Mochi's instructions and the delegate description to split work into disjoint scopes with a brief, and put the new abilities in the roster text (the instructions version changes, so old conversations are not resumed); verify with a unit test and one live run on a fresh project
- [ ] 3.9 Add fake-CLI scripts that create, update and delete by id inside a scope, and an e2e test where three scoped fake tasks overlap in time, each produces its own undo step and one refused touch names its holder

## 4. Python and Rhino scripts (ends with: declared outputs, stamped objects and an after-the-run report)

- [ ] 4.1 Add `outputs` to `python_run`: reserve the paths per task, refuse a path another running task holds, offer only declared files that changed, report undeclared `.3dm` writes, and give kept scripts collision-free names; verify "Same file twice", "Undeclared write" and "Same title in the same second" against the real environment (skipped without Python)
- [ ] 4.2 Show the declared outputs on the approval card, and keep the always-allow path from hiding a refusal; verify with the fake agent
- [ ] 4.3 Queue `rhino.python.run` in the bridge so scripts take turns, and send agent, title and claim in the message; verify "Scripts take turns" with the fake Rhino client
- [ ] 4.4 Add `changes` (added, changed, deleted ids with their owner tags) to the run result, compare it with the claim in the bridge and report strays to the agent and the user with an undo-the-run offer; verify "Script stays in scope" and "Script strays" with the fake Rhino client
- [ ] 4.5 Plugin: stamp `hai.owner` and `hai.part` on objects added during a run, snapshot all objects before and after, and return `changes`; unit tests for the diff in the core library; verify on Rhino 8 by the manual script
- [ ] 4.6 Mirror: show owner colour for Rhino objects from their tags (see 5.2); verify with the fake Rhino client

## 5. Showing it (ends with: you can see who is working on which part)

- [ ] 5.1 Carry the claims in `team.snapshot` and keep them in the web agent client; verify with a client-side unit test and that a claim shows within 200 ms (p90) of being granted
- [ ] 5.2 Draw owner outline and tint in the viewer (scene elements and mirrored objects) under selection, hover and the pending-deletion mark, and translucent claim boxes for regions; verify "Owned elements are tinted", "Selection stays on top", "Rhino objects too" and "Region box" by e2e
- [ ] 5.3 Add the Parts list to the agent panel (agent, task, scope, element count, hover highlight, "waits for") and the claim line on the team chips; verify "Hover a claim" and "Waiting reason" by e2e
- [ ] 5.4 Add the **Parallel modelling** feature and the **Show owners** setting and keep them in `.hai/settings.json`; verify "Show owners off" and that Parallel modelling off restores one writer at a time
- [ ] 5.5 Screenshots of the owner display and the Parts list in light and dark, and a visual pass for overlap with the selection and the section tools

## 6. Docs and demo

- [ ] 6.1 Write `docs/parallel.md` (scopes, the brief, what a refusal says, tags, scripts and what is only checked afterwards, the switches) and update `docs/agents.md` and `docs/agent.md`; the docs tests must pass
- [ ] 6.2 Write `demos/16-parallel-agents.md` ("Three agents, one model": split, three tinted regions filling in together, a refused touch naming its owner, one undo reverts one part, the claim shown in the panel) and record the clip; verify on a real run with Claude Code
