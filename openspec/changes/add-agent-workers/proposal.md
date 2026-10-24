# Proposal

## Why

A specialist works through one request in one session. For a request like "the Taj Mahal: dome, four minarets, gateway, garden, reflecting pool", one Architect does the parts one after another, however many agents Mochi could in principle hand them to, because Mochi sees only agents, not parts. The parallel-modelling change (`add-parallel-agent-modelling`) makes simultaneous work safe with claims, owners and per-agent undo; it lets Mochi split work across *different specialists*. It does not let a specialist split *its own* task: Architect cannot say "I will take the dome, you take the minarets" to a copy of itself.

Claude Code has native subagents (the Task tool), and they are the obvious first thought. They do not fit this app: a native subagent calls HAI's tool server with its parent's token, so the bridge cannot tell the dome from the minarets, cannot enforce a claim per part, cannot group each part as its own undo step, and the UI sees none of it. So the fan-out has to be HAI's own: worker sessions the bridge starts, identifies, claims for and shows.

The previous change in this series (agents run with a HAI-managed tool list) made sure every agent can actually see its tools, `python_run` and the panel tools included; workers inherit that.

## What Changes

- Specialists that change the model get a `spawn_worker` tool (title, instruction, scope). The bridge starts another session from the same managed definition (named `architect.2`, `architect.3`), with its **own token**, a **sub-claim carved out of the parent's claim**, and its own undo group. Workers cannot spawn workers, and `delegate` stays with Mochi.
- The parent keeps working while workers run and receives each worker's summary when it ends; a task ends only after its workers have.
- Workers show **nested under their parent** in the team strip and the Parts list, in the parent's colour; their approval cards name the worker and wait under the parent's chip; one Stop on the parent stops its workers.
- Native Claude Code subagents stay available to every agent for **read-only** help (research, review of a draft), under the parent's identity. They are never a way to change the model.
- A cap on live sessions (default 6, a setting) with the cost said plainly: each worker is a model session.
- **Panels with workers**: the single panel slot becomes a short per-agent queue (an offer waits for the open panel instead of being refused), a panel names the agent that opened it, and Mochi can open an optional **plan panel** to confirm how a request is split into parts before workers start.

## Capabilities

### New Capabilities
- `agent-workers`: spawning, identifying, claiming for, grouping, showing and ending a specialist's worker sessions, and how panels behave with several agents.

### Modified Capabilities
- `agent-team`: the limits (sessions at once now count workers), Stop and status cover workers, and the team strip nests them.

## Impact

- `apps/bridge`: `Team` (worker records, spawn, limits, release), `AgentHub` per worker, `scene-tools` (`spawn_worker`), claim table (sub-claims), panel broker (queue).
- `packages/protocol`: `TeamTask.parent`, worker fields on `team.snapshot`, `spawn_worker` input.
- `apps/web`: team strip and Parts list nesting, plan panel, session-cap setting.
- Docs: `docs/agents.md`, `docs/parallel.md` (from the parallel-modelling change).

**Depends on** `add-parallel-agent-modelling` (claims, per-agent undo groups, owner display). It cannot be applied before it.

**Out of scope:** workers spawning workers; native subagents changing the model; workers on another machine; choosing a different model per worker; automatic splitting without Mochi's or the specialist's decision.

**Demo clip (45-60 s):** `demos/17-workers.md` - "One architect, five hands". Asked for a pavilion, Architect splits it into dome, minarets and garden, three workers appear nested under it in its colour and fill their parts at the same time, one asks for a panel to tune a clearance while another keeps modelling, and Stop ends all of them.
