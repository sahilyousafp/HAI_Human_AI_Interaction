# Proposal

## Why

One general agent is not how a design team works. The user wants a lead they can talk to, **Mochi**, that splits a request across specialists (architecture, product design, environmental simulation, review), reports what everyone is doing whenever asked, and answers out loud, so the hands and eyes stay on the model. The single agent session from `add-claude-agent-bridge` cannot be asked for status while it works, and it cannot run specialists side by side.

## What Changes

- **An agent team.** Mochi (Claude Sonnet 5.5) receives every request and hands work to specialists, each with its own instructions, tools and model.
  - The agents are defined in the project's `.claude/agents/*.md`, Claude Code's own format, so they work in a terminal too.
  - First specialists: Architect, Product, Climate (environmental simulation) and Reviewer (checks, never edits).
  - New specialists can be added as files; Mochi routes to them without changes to Mochi.
- **Each agent is its own session.** Specialists run side by side, with up to three at once and one writing to the model at a time. Each writer's work is one undo step labelled with the agent's name. The user can stop a single task.
- **Status on demand.** "Mochi, what is everyone doing?" gets an answer while the specialists keep working. When delegated work finishes, Mochi reports back by itself.
- **Addressing by name.** A request that starts with an agent's name ("Architect, add a stair core here"), or mentions `@architect`, tells Mochi who should do it. Names are matched forgivingly, because speech recognition mishears names.
  - An opt-in **listen for names** mode keeps the on-device microphone listening and acts only on utterances that start with a team name.
  - It has its own visible indicator.
- **Spoken replies.** Mochi's replies and reports are read aloud in a natural voice generated on the laptop, starting with the first sentence while the rest is still being written. Speaking stops as soon as the user starts talking. There is a mute control.
- **Team view in the agent panel.**
  - A strip shows each agent's state and current task.
  - Delegations appear as chips that open the specialist's own thread.
  - An Agents tab lists the roster and lets the user add or edit an agent.
- **A sun and shadow study for Climate.** Given a date, a time and a location, Climate sets the viewer's sun and sees the shadows.

**Out of scope:**
- Real simulation engines (Ladybug, Grasshopper, energy or daylight analysis), which come with `add-rhino-connector`.
- Product-scale geometry beyond the current scene elements.
- Agents talking to each other directly. They coordinate through Mochi.
- Wake words other than the agents' names.
- Languages other than English.
- Providers other than Claude Code.
- Reviewing agent turns before they land, which belongs to `add-agent-turn-review`.

**Demo clip (Week 8):** "Mochi, my design team."
1. Say "Mochi, ask Architect for a stair core here and Climate for the winter shadows" while pointing at a block.
2. The team strip lights up: Architect working, Climate working.
3. Ask "Mochi, status?" and hear a spoken answer about who is doing what.
4. The model changes and Climate's shadow study appears.
5. Mochi says both are done.

## Capabilities

### New Capabilities

- `agent-team`: the roster of agents defined in the project, Mochi's delegation to specialists, how tasks are scheduled, run, stopped and reported, status on demand, and the team view in the agent panel.
- `agent-addressing`: how a typed or spoken request names an agent, how names are matched, and the opt-in listen-for-names mode.
- `spoken-replies`: reading Mochi's replies aloud on the laptop, interruption by the user, and muting.

### Modified Capabilities

None. This change builds on `agent-session` and `agent-panel` from `add-claude-agent-bridge`, and on `voice-input` and `multimodal-intent` from `add-voice-point-and-speak`. Those are not yet archived specs, so the team behaviour is specified here as new capabilities.

## Impact

- `.claude/agents/`: default agent files are written into a project the first time the team is used. They are never overwritten.
- `packages/agent-core`: an agent can be started by name.
- `apps/bridge`:
  - one session per agent, plus a task board and scheduler;
  - agent identity on the MCP endpoint;
  - delegation and status tools for Mochi;
  - per-agent tool limits enforced by the bridge;
  - Mochi's digest turns.
- `packages/protocol`: agent names on turns and events; team and task messages.
- `packages/scene`: a solar position calculation.
- `apps/web`: team strip, threads, Agents tab, name matching, the listen-for-names mode, the reply speaker and its settings.
- **New runtime asset:** the Kokoro-82M speech model (Apache-2.0, 325 MB, fetched once by `pnpm assets` with a SHA-256 check).
- **New dependency:** `phonemize` (MIT). `kokoro-js` is not used because it bundles eSpeak NG (GPL-3.0).
- Requires Claude Code 2.1.281 or later for running a session as a named agent. The installed 2.1.303 qualifies.
