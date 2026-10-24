# Tasks

Depends on `add-parallel-agent-modelling` (claims, per-agent undo groups, owner display) being applied first.

## 1. Worker sessions (ends with: a fake-CLI specialist starts a worker that works and reports)

- [ ] 1.1 Add the worker record to the team (id, parent task, name `<agent>.<n>`, title, instruction, status) and `TeamTask.parent` / `kind` in the protocol; verify with unit tests of the board and the snapshot schema
- [ ] 1.2 Start a worker session from the parent's managed definition under the worker's name (own token, own `session.json`, `--agents` entry written under that name, `spawn_worker` and `delegate` removed, instruction as preface); verify with the fake CLI that the process starts with the right flags and token
- [ ] 1.3 Add the `spawn_worker` tool (specialists that change the model only; refused for Mochi, workers and when Parallel modelling is off); verify "Workers cannot start workers" and "No workers without Parallel modelling" through the MCP client
- [ ] 1.4 Return each worker's outcome and summary to the parent as a note turn, and keep the parent's task running until its workers end; verify "Parent waits"
- [ ] 1.5 Cancel workers from `finish()`, `stopAll` and project switch, and on parent failure or crash, releasing their claims first; verify "Stop the parent" within 3 seconds with the fake CLI, including a worker that ignores the interrupt

## 2. Claims for workers (ends with: two workers fill disjoint parts at the same time)

- [ ] 2.1 Make a worker's claim a child of its parent's in the claim table (inside the parent's, never overlapping a sibling, the parent's own check subtracts what its children hold, the part returns on end); verify "Scope outside the parent's claim", "Overlapping workers" and "The parent leaves the worker's part alone"
- [ ] 2.2 Give each worker its own undo group, label and `by`, and owner stamps naming the worker; verify "Undo one worker" with interleaved edits
- [ ] 2.3 Add fake-CLI scripts for a specialist that spawns two scoped workers that each create elements, and an e2e test where the workers overlap in time, each has one undo step and a refused touch names the holder

## 3. Limits and cost (ends with: the session cap is a setting)

- [ ] 3.1 Add `maxSessions` (default 6) counting Mochi, running specialists and workers, with a queue and `waitingFor` for workers over the limit; verify "Workers count toward the limit" and "Over the limit"
- [ ] 3.2 Add the setting to Settings > Agents with the cost note, kept in `.hai/settings.json`; verify by e2e that changing it changes the limit
- [ ] 3.3 Log session starts and ends with timings; check the idle close and `maxSessions` leave no process behind after a run

## 4. Native subagents that only look (ends with: every agent can use read-only helpers)

- [ ] 4.1 Add `Task` and read-only entries for every other team name plus `scout` and `checker` to the managed `--agents` file; verify with a unit test that no helper lists a tool that changes the model or runs a script
- [ ] 4.2 Verify with a live run (manual, `HAI_LIVE_CLAUDE=1`) that Architect can start a read-only helper, that a helper named after a teammate has no modelling tools, and record the result in `docs/decisions.md`

## 5. Showing workers (ends with: you can see who is working under whom)

- [ ] 5.1 Nest workers under their parent in the team strip and the Parts list in the parent's colour with title, state and scope; verify "Nested display" by e2e and a screenshot in light and dark
- [ ] 5.2 Show worker approval cards under the parent's chip, naming the worker; verify "Worker approval" with the fake agent
- [ ] 5.3 Make the owner display and claim boxes use the parent's colour for workers; verify by e2e

## 6. Panels with several agents (ends with: a second offer waits instead of failing)

- [ ] 6.1 Queue up to two waiting offers in the panel broker with a 60 s expiry, tell the offering agent it waits, and label every panel and offer with its agent; verify "Second offer waits" and the expiry
- [ ] 6.2 Add the plan panel: Mochi's instruction and tool text for offering it, a panel that lists parts with remove buttons and returns the confirmed parts, and worker start only after confirm; verify "Plan panel" with a fake-CLI script and a hand-driven e2e
- [ ] 6.3 Live check (manual): a worker's panel offer queues behind its parent's open panel, and both complete

## 7. Docs and demo

- [ ] 7.1 Update `docs/agents.md` (workers, the session limit, Stop, native helpers, panels with several agents) and `docs/parallel.md`; the docs tests must pass
- [ ] 7.2 Write `demos/17-workers.md` ("One architect, five hands": split, three workers nested under Architect filling their parts together, one worker's panel waiting its turn, Stop ending all) and record the clip; verify on a real run with Claude Code
