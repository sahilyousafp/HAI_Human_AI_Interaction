# Design

## Context

What exists, and what the previous changes in this series add:

- Each agent is its own `claude --agent <name>` process with its own token; the bridge knows which agent calls a tool through that token (`agent-tokens.ts`). The token is bound to the process, not a task. `Team` keeps one active task per agent and publishes the board on `team.snapshot`.
- Since the managed-definition change, HAI starts each agent with `--agents <file>` so its tools come from its role, not from a stale project file. That file is also where this change decides what native subagents an agent can use.
- `add-parallel-agent-modelling` (this change depends on it) adds a claim table (ids, part and region scopes, one claim per task), the claim check in the scene tool handlers keyed by the calling agent, per-agent undo groups, `scene.patch.by`, owner display and the Parts list.
- Claude Code's native subagents (the Task tool) run inside the parent's process. Every MCP call they make carries the parent's token, so the bridge sees the parent. A session can only start a subagent if `Task` is in its tool allowlist, and a subagent's tools are those of its own definition. Today no HAI agent lists `Task`, so none can.
- Panels: one slot in the broker (`panels.ts`); an offer made while a panel is open is refused.
- The live session count today is at most 1 (Mochi) + `maxRunning` (3), documented in `docs/agents.md`.

## Goals / Non-Goals

**Goals:**
- A specialist can split its own task into parts that run at the same time, with the same guarantees as Mochi's split across specialists: a claim per part enforced by the bridge, an undo step per part, owner and state shown in the UI.
- Stop, failure and crash take workers with them, and nothing is left claimed.
- The cost of more sessions is bounded and visible.
- Panels stay usable when several agents want one.

**Non-Goals:**
- Recursive workers, workers on other machines, per-worker models, automatic splitting with no agent deciding, native subagents that change the model.

## Decisions

**A worker is a named session of the same definition, not a Claude Code subagent.** The bridge starts `architect.2` the way it starts any agent: a process, an MCP token that identifies the worker, its own `session.json`, its own transcript. Everything the earlier changes built on agent identity (claim checks, undo groups, `by`, approval attribution) then works unchanged. Rejected: native Task subagents as the fan-out (one token for the parent and all its subagents, so no per-part claim, no per-part undo, no UI; `--forward-subagent-text` shows their words but cannot give them an identity); one session with many threads (Claude Code sessions are sequential turns).

**The definition is the parent's, narrowed.** A worker gets its parent's managed definition with `spawn_worker` and `delegate` removed and the worker's instruction as its task preface. Its `--agent` name is the worker's name and its `--agents` entry is written under that name, so a worker needs no file in `.claude/agents` (and none appears in the Agents tab). Model and tools follow the parent.

**Scopes are carved, never shared.** `spawn_worker` takes a scope in the same three forms as a task. The claim table treats a worker's claim as a child of the parent's: the child must lie inside it, children must not overlap, and the parent's own check subtracts what its children hold, so the parent cannot write a worker's part while it runs. When a child ends its part returns to the parent. One check, in one place, with the rule "an element belongs to the deepest running claim that contains it". Rejected: letting the parent and a worker share a part (that is the conflict the parent change removes); a separate worker-only claim table (two tables to keep in step).

**Parent waits, and the board says so.** A task finishes when the parent's own turn has ended and every worker has finished. The parent is told each worker's outcome and summary as a note turn, the way Mochi hears from specialists (the existing digest mechanism), so the parent can fix a failed part or report. Stop, failure and crash of the parent cancel its workers through `finish()`, the one place every task already ends, which also releases claims before scheduling. Rejected: fire-and-forget workers (their changes would outlive the task that owns the undo step and the claim).

**Session limit is its own number.** `maxRunning` (3 specialists) stays for tasks. A new `maxSessions` (default 6, in Settings > Modelling > Agents working together, saved with the workspace) counts every live process: Mochi, each running specialist and each worker. A worker over the limit waits in a queue with the same `waitingFor` display as a queued task. Settings says each worker is a model session with its own cost; a multi-agent run uses several times the tokens of a single agent, and the limit is the user's control. Rejected: no limit; a limit per specialist (it does not bound the cost the user cares about).

**Native subagents are read-only helpers, by definition.** A session can use Task only if its allowlist has it, and a subagent's tools come from its own definition. So the managed `--agents` file gives every agent `Task` and, besides its own entry, an entry for every other team name with only the read and view tools, plus two generic helpers (`scout`: read tools and web search; `checker`: read tools). The project's own files cannot grant a teammate-named subagent modelling tools because the CLI entry overrides the file (verified in the managed-definition change). What the bridge can still not see is who inside a parent calls a read tool, which is harmless. Rejected: trying to detect and refuse a subagent's write in the bridge (same token, no way to tell).

**Panels: queue, label, plan.** The broker keeps one open panel but holds up to two waiting offers (FIFO, 60 s expiry), tells the offering agent how long it waited when the call returns (the offer tool already waits for an answer, so the wait is natural), and every panel and offer card carries the agent's name. Offers are per agent, so a worker's offer queues behind its parent's panel. A waiting offer is not shown to the user until it is its turn. The plan is a **plan card** with its own tool (`confirm_plan`) and small broker, not a generated panel: a panel has no way to return the user's choice to the agent that opened it (`open_panel` returns once the page has loaded it, and the agent only hears how it closed), so a panel could not tell Mochi which parts were kept. The card lists the parts (agent, title, scope) with a remove button each and Confirm or Skip; the tool waits for the answer (two minutes at most) and returns the kept parts. Rejected: several panels open at once (the screen and the hand cannot serve more than one); a generated plan panel (no result channel).

**UI nesting from data already published.** `TeamTask` gains `parent` (task id) and the team snapshot lists workers as tasks with `kind: "worker"`; the strip groups by parent and the Parts list indents. Workers use the parent's colour in the owner display. Nothing about worker state is invented client-side.

**Budgets.** Starting a worker (call to its session ready to take a turn) is dominated by process start and model load; it is reported in the log, not budgeted. Claim and stop budgets are inherited: claim check under 5 ms p90; worker and claim released within 3 seconds of a stop.

## Risks / Trade-offs

- [Cost multiplies with workers] -> The limit, the visible cost note, and the fact that fan-out is the specialist's decision per task. The default 6 caps it.
- [A specialist splits badly] -> Claims make a bad split cost time, not data; the parent hears each outcome and can redo a part.
- [Many Claude Code processes on a laptop] -> A worker is started only when spawned and closed when its task ends; the existing 20-minute idle close applies; sessions are bounded by `maxSessions`.
- [Workers lose the parent's conversation context] -> The instruction must carry what the worker needs, as Mochi's delegate does; the parent's shared brief (from the parallel change) is prefaced to each worker too.
- [Panel queue hides a long wait] -> The offering agent and the user both see the waiting offer and its 60 s expiry.
- [Plan panel adds a step before work starts] -> It is offered only when Mochi chooses to, and skipped with a nod.

## Resolved while applying

Findings that settled open points of the design, from the code and from running it:

- **A worker's name may contain a dot.** Verified with the real Claude Code: `--agent architect.2` with the same name as a `--agents` entry starts and answers. It is shown as "Architect 2".
- **Parts are hierarchical.** A part tag is matched with its sub-parts (`dome` takes in `dome/ribs`), so a worker's part is a sub-part of its specialist's (`pavilion/dome`), disjoint from its siblings', and its elements are in the specialist's claim too. A part outside the claim, or a name that is not a sub-part, is refused with how to write one.
- **The claim rule is "the claim cut from yours holds it".** The earliest-granted rule alone would let a parent change a worker's part (the parent was granted first). A claim's holder is now the earliest claim that is not one of the caller's parents, and a claim cut from the caller's holds its part whatever the order. The check stays linear in the number of claims.
- **A task is one undo step even with note turns.** The undo group of a specialist's task now closes when the task ends, not when its first turn does, so the turns in which it hears from its workers go into the same step.
- **Sessions counted are live work.** Mochi (always one), each specialist with a task and each worker; a worker or task over the limit waits for a free session (`waitingForSession` on the board). The limit is a live setting.
- **`agents.json` has several entries.** The agent's own definition and its read-only helpers.
- **Mochi's tools.** Existing Mochi files list only the three team tools, so the lead is granted `confirm_plan` whatever its file lists.
- **Timers of a waiting offer.** A queued offer waits at most 60 s for its turn; once shown, the user has the usual 60 s to answer.

