# Tasks

## 1. Agents by name

- [x] 1.1 Add `agent` to `StartOptions` and `--agent <name>` to `buildClaudeArgs`; extend the fake CLI to honour `--agent` (record it, answer as that agent); verify unit tests and the docs flag test
- [x] 1.2 Shared frontmatter reader (replacing `parseSkill`'s parser) and roster loader for `.claude/agents/*.md` plus `.aex/agents.json`; write default definitions for mochi, architect, product, climate and reviewer only when missing; verify "defaults created once", "user edits are kept" and "a new specialist is routable" unit tests

## 2. One session per agent

- [x] 2.1 Generalise `AgentHub` to one instance per agent with its own session id, transcript, resume, idle close and interrupt; migrate a project's previous session to Mochi; verify the existing agent-hub tests per agent and a migration test
- [x] 2.2 Per-agent MCP tokens and identity: generate each agent's `mcp.json` with its own token, resolve token to agent in the endpoint, register only that agent's tools; verify "reviewer cannot edit" with the fake CLI and that the session token no longer works for MCP

## 3. Team and scheduler

- [x] 3.1 `Team` with the task board: `delegate`, `team_status` and `cancel_task` tools for Mochi, task records with last activity and summaries; verify "two specialists at once" and that `delegate` returns in under 50 ms
- [x] 3.2 Scheduler: at most 3 running, one writer at a time, per-agent queue, undo step labelled "<Agent>: <title>"; verify "second writer queues" and "one undo per specialist task"
- [x] 3.3 Digest turns: when a batch finishes, send Mochi the outcomes; queue digests behind a running user turn; verify "report when done" and "status while working" with the fake CLI acting as Mochi
- [x] 3.4 Stop: stop one task or all (click, two palms, asking Mochi), keeping changes as one undo step; approval cards name the agent; verify "stop one task" within 3 s

## 4. Protocol and panel

- [x] 4.1 Protocol: agent names on turns, events and approvals; `team.snapshot` and task messages; `agent.send` carries the intended agent; verify schema tests
- [x] 4.2 Team strip and threads: per-agent state chips, hand-off chips that open the specialist's task thread, agent names on tool chips and cards; verify "team strip follows the work" and "hand-off opens the specialist's conversation" E2E with the fake CLI
- [x] 4.3 Agents tab: list definitions; add and edit an agent (writes the `.md` file and the `.aex/agents.json` entry, applies from the next task); verify E2E and a screenshot baseline

## 5. Addressing by name

- [x] 5.1 Name matcher (first one or two words, aliases, edit distance 1, `@name`) used for typed and spoken requests; verify "spoken specialist name", "misheard name", "split name" and "no name" unit tests, and "Mochi asked to delegate" with the fake CLI
- [x] 5.2 Spoken routing E2E: the `architect-stair-core` and `mochi-ask-climate` fixtures (trimmed) route to the right agent through the fake microphone; verify the received turns
- [x] 5.3 Listen for names: opt-in setting, continuous on-device listening, unnamed utterances dropped in memory, distinct header indicator; verify "named utterance becomes a request", "other speech is ignored" and "off by default" E2E, and the audio privacy test while listening

## 6. Spoken replies

- [x] 6.1 Fetch Kokoro-82M fp32 and two voices with SHA-256 pins in `scripts/assets.lock.json`; speaker worker (WebGPU) with `phonemize` and the phoneme clean-up; verify a unit test of the clean-up and an E2E round trip (spoken audio transcribed back by Moonshine contains the sentence's words)
- [x] 6.2 Sentence streaming of Mochi's replies and digests, local system voice fallback without WebGPU, barge-in on the microphone and stop, mute remembered; verify "first sentence starts early", "talking interrupts" and "muted", and the network check that no speech service is called

## 7. Climate's sun study

- [x] 7.1 NOAA solar position in `packages/scene`; `sun_study` tool for Climate that sets the viewer's sun, waits for the render and returns the angles with `capture_view`; verify sun positions against NOAA reference values and the "winter shadows" scenario E2E

## 8. Docs and live check

- [x] 8.1 `docs/agents.md` (the team, definitions, scheduling, status, names, spoken replies, privacy) and updates to `docs/agent.md`, `docs/voice.md` and `PROVIDERS.md`; verify the docs flag test and a timings check for documented values
- [x] 8.2 Live check marked manual (`AEX_LIVE_CLAUDE=1`): Mochi on Sonnet 5.5 hands a real request to Architect, answers a status question while it works, and reports back; verify it passes once on the maintainer's plan

## 9. Demo

- [ ] 9.1 Write `demos/08-mochi-team.md` ("Mochi, ask Architect for a stair core here and Climate for the winter shadows", the team strip, "Mochi, status?", spoken answer, Mochi reports both done) and record the Week 8 clip; verify it works on the real microphone in two of three takes
