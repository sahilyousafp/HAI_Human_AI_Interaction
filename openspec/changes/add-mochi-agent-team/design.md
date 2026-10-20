# Design

## Context

See proposal.md for why. Today the bridge runs one Claude Code process per project:
- `AgentHub` (`apps/bridge/src/agent/agent-hub.ts`) owns that process;
- `buildClaudeArgs` (`packages/agent-core/src/claude/provider.ts`) builds its command line;
- one MCP server, `aex`, with one session token, serves the scene tools (`apps/bridge/src/mcp`);
- approvals go through `approve_tool`;
- the scene store keeps one open turn group, so a turn is one undo step.

The web has one transcript, voice requests (`apps/web/src/voice`) and the Moonshine worker. Measured facts this design relies on are in `docs/decisions.md` (2026-10-20):
- `claude -p --agent <name>` applies a project agent file's model and tools, and `sonnet` resolves to Sonnet 5.5;
- Kokoro runs faster than real time only on WebGPU in fp32;
- Moonshine mishears "Mochi" and "Reviewer" in known ways.

Reference: `D:\Personal\Agentic_Rhino` (RhinoCopilot). Its lead router delegates with an app-served `delegate` tool, runs each role as its own process with its own token, and wakes the lead with a digest. We follow that runtime pattern.

## Goals / Non-Goals

**Goals:**
- Mochi stays responsive while specialists work, so status questions are always answerable.
- Every model change is attributable to an agent and undoable per specialist task.
- Adding a specialist is a file, not code.

**Non-Goals:**
- Agent-to-agent messaging.
- Dependency graphs between tasks (Mochi sequences work itself with follow-up delegations).
- Parallel writers to the model, which would need turn review or per-agent merging (`add-agent-turn-review`).

## Decisions

**Agents are separate `claude -p --agent <name>` processes, managed by the bridge.**
- `StartOptions` gains `agent`, and `buildClaudeArgs` adds `--agent <name>`.
- Each agent keeps its own session id (`.aex/agent/<name>/session.json`), transcript, resume, idle close and interrupt, by generalising `AgentHub` to one instance per agent.
- Rejected: Claude Code's in-process subagents through the Agent tool. Mochi's process stays busy during the delegation and a new message interrupts it, so status-while-working is impossible, and every subagent's MCP calls carry Mochi's token, so the bridge cannot tell agents apart.

**Definitions in `.claude/agents/<name>.md`, extra metadata in `.aex/agents.json`.**
- Claude Code's frontmatter carries `name`, `description`, `tools` and `model`. `tools` uses full MCP names such as `mcp__aex__create_elements`.
- AEX-only fields (aliases, colour, `writes`: whether the agent changes the model) go in `.aex/agents.json`. Claude Code then never sees unknown frontmatter.
- Defaults are written only when a file is missing.
- A shared frontmatter reader replaces `parseSkill`'s private parser (`apps/bridge/src/agent/extensions.ts`).
- Rejected: an AEX-only roster passed with `--agents` JSON. The agents would not exist outside AEX, and the user chose project files.

**Agent identity on the MCP endpoint.**
- Each running agent gets its own random token in its generated `mcp.json`. The endpoint resolves token to agent before creating the MCP server, and the server registers only that agent's allowed `aex` tools, so Reviewer has no write tools at all.
- Mochi's tools: `delegate`, `team_status`, `cancel_task`, and the read and capture tools.
- The session token still authenticates browsers on the WebSocket and is no longer valid for MCP.
- Rejected: trusting an agent name sent by the client.

**`Team` owns the task board and the scheduler.**
- **Task fields:** id, agent, title, instruction, status (queued, running, waiting for approval, done, failed, stopped), created, started, finished, last activity (the latest tool chip or reply line) and summary (the agent's final reply, truncated).
- **Scheduling:** up to 3 tasks at once.
- **Writer lock:** a task whose agent `writes` waits while another writing task runs. Agents run one task at a time, and later tasks for the same agent queue.
- **Undo labels:** a writing task opens the scene turn group with the label "<Agent>: <title>" and closes it when it ends or stops. That reuses `SceneHub.beginTurn`/`endTurn`, which assume one open group.
- Rejected: per-agent transaction groups with interleaving. Undoing one agent's group after another agent edited the same element has no correct answer without review.

**Mochi's turns.**
- Requests from the user go to Mochi with an optional "[for: <agent>]" line when the user named a specialist.
- `delegate` returns the task id immediately, so Mochi's turn ends quickly.
- When the last task from a Mochi turn's batch finishes, `Team` sends Mochi a digest turn (`[team] Architect "stair core": done. <summary>`), and Mochi's reply is the report.
- Digest turns wait if the user's own turn with Mochi is running.
- Mochi's prompt carries a roster generated from each agent's `description`, as RhinoCopilot's generated team list does.

**Approvals and extensions.**
- Approval cards gain the agent's name. The broker resolves the agent from the calling token in the same way.
- Extension changes restart every agent session (each resumes its own conversation).

**Name matching in the web.**
- A pure matcher normalises the first one or two words (lower case, punctuation removed) and compares them with each name and alias, allowing an edit distance of 1.
- `@name` anywhere also matches.
- Default aliases come from the recorded mishearings: "machi", "maci" and "mochie" for Mochi, "review or" for Reviewer.
- Typed and spoken requests use the same matcher; the matched target travels in the `agent.send` payload, not in the text.

**Listen for names.**
- The existing VAD and Moonshine pipeline runs continuously while the setting is on: utterance in, transcript out.
- Transcripts without a leading name are dropped at once, in memory, never shown.
- A named transcript enters the normal review countdown with point-and-speak capture.
- The header pill shows "Listening for names" in a distinct style.
- Rejected: a dedicated wake-word model. openWakeWord's pretrained models are non-commercial and Porcupine is proprietary.

**Spoken replies.**
- A speaker worker runs Kokoro-82M through transformers.js (`StyleTextToSpeech2Model`, WebGPU, fp32), with `phonemize` (MIT) for text-to-phonemes. Stress marks move before the vowel; `ɫ` becomes `l` and `ɝ` becomes `ɜɹ`.
- Mochi's streamed reply text is split into sentences; each is synthesised and queued for playback with the Web Audio API.
- Without WebGPU, a local `speechSynthesis` voice (one with `localService` true) speaks instead, and the Voice settings name the voice in use.
- Barge-in: the voice controller's start cancels playback and pending synthesis.
- Rejected: `kokoro-js`, because its `phonemizer` dependency bundles eSpeak NG (GPL-3.0); online neural voices, which send text to a third party; and int8 on WASM, which is slower than real time.

**Climate's sun study.**
- `sun_study(date, time, latitude, longitude)` computes the sun's position with the NOAA solar position algorithm, a pure function in `packages/scene`.
- The bridge tells the viewer to place its directional light at that altitude and azimuth (scene north is +Y, as in Rhino), waits for the view to render, then returns the angles and a `capture_view` image.
- The light is restored when the user presses Escape or another tool runs.

**Panel.**
- A team strip sits under the header.
- The Chat tab shows Mochi's thread. A hand-off renders as a chip with live status; selecting it shows that agent's task thread in place, with a back control.
- The Agents tab sits beside Extensions: it lists definitions and has a form that writes the `.md` file and the `.aex/agents.json` entry.
- The web client keys turns, events and approvals by agent name.

**Latency budgets.**
- **Status answer:** Mochi's first spoken word comes within about 3 s of sending a status question. That is one Sonnet turn with one tool call; it is measured in the live test and the demo.
- **Speech:** time to first audio for a one-sentence reply is under 1.2 s on the reference laptop with WebGPU, measured from the sentence's arrival to the start of playback in the speaker worker. It is shown in the Voice settings.
- **Hand-off:** `delegate` returns in under 50 ms, measured in the bridge integration test.

## Risks / Trade-offs

- **[Three Claude processes at once use more of the user's plan]** → Concurrency is a setting (default 3, minimum 1). The panel shows how many agents are running.
- **[A specialist misunderstands its instruction]** → The task thread shows everything it did, its writes are one undo step, and the user can stop it or ask Mochi to retry.
- **[The writer lock serialises model changes]** → Accepted for safety. Read-only work (Reviewer, Climate studies) stays parallel. Turn review later allows parallel writers.
- **[Kokoro's 325 MB download]** → It is fetched once by `pnpm assets` and checksum-verified. Spoken replies work with the local system voice until it is present.
- **[Name matching false positives in listen-for-names mode]** → Only the first two words are matched, a name followed by a pause or punctuation is required, and the review countdown gives a chance to discard.
- **[Claude Code changes how `--agent` treats tools or models]** → Covered by the live manual test and by the docs flag test against `buildClaudeArgs`.

## Migration Plan

Existing projects keep working. On the first request after the update, the default agent files are created and the previous single session becomes Mochi's session; its conversation id is moved to `.aex/agent/mochi/session.json`. Rolling back means deleting the generated files; the bridge then falls back to a single default session.
