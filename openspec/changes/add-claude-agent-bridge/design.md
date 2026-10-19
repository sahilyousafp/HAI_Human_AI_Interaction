# Design

## Context

Builds on the scene store in the bridge (`add-gesture-viewport-navigation`) and the gesture stream (`add-gesture-recognition`). Facts checked against the locally installed Claude Code 2.1.303: `-p` supports `--input-format stream-json`, `--output-format stream-json` with `--verbose` and `--include-partial-messages`, `--mcp-config`, `--permission-prompt-tool`, `--append-system-prompt-file`, `--resume`, and `claude auth status --json`. `claude mcp add|remove --scope project` manages the project's `.mcp.json`. The MCP TypeScript SDK v2 ships as `@modelcontextprotocol/server` 2.3.x and `@modelcontextprotocol/node` 2.1.x with zod 4.

## Goals / Non-Goals

**Goals:**
- The agent feels like the user's own Claude, with their MCP servers and skills, now able to see and edit the model.
- Every scene change is visible and undoable per turn; anything else needs the user's say-so.
- The provider boundary is clean enough that Codex or a local model can be added later without touching the bridge.

**Non-Goals:**
- Managing user-level Claude Code configuration (the user does that in Claude Code).
- Plugins, subagents or hooks management in the UI (they still load from the user's Claude Code setup).

## Decisions

**Spawn command.** In the project folder (cwd):
```
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
  --mcp-config <.aex/agent/mcp.json> --permission-prompt-tool mcp__aex__approve_tool
  --append-system-prompt-file <.aex/agent/system.md> [--resume <sessionId>]
```
No `--strict-mcp-config`, no `--tools` restriction and no `--setting-sources` restriction, so the user's own servers, skills and settings load normally. The generated `mcp.json` adds only the `aex` server (streamable HTTP at `http://127.0.0.1:<port>/mcp` with an `Authorization: Bearer <session token>` header). Rejected: `--bare` (ignores subscription login and skips the user's setup); `--strict-mcp-config` plus `--tools ""` (would hide the user's servers and skills).

**Windows spawning.** Resolve the executable with `where claude`; spawn through `cross-spawn` so `.cmd` shims work without `shell: true` quoting bugs. stdin, stdout and stderr are piped; stdout is parsed as newline-delimited JSON with a line buffer.

**Provider interface** (`packages/agent-core`):
```ts
interface AgentProvider { id; detect(): Promise<Detection>; start(opts): Promise<AgentSession> }
interface AgentSession { send(turn): AsyncIterable<AgentEvent>; interrupt(); close(); sessionId?: string }
```
`AgentEvent` is a provider-neutral union: `init` (servers, tools, skills), `text.delta`, `tool.start`, `tool.end`, `turn.end` (usage), `error`. `ClaudeCliProvider` maps stream-json `system/init`, `stream_event` partial deltas, `assistant` tool_use blocks, `user` tool_result blocks and `result` into it. The web never sees raw stream-json.

**Session lifecycle.** One process per open project. The `session_id` from the init event is stored in `.aex/agent/session.json`. If the process exits unexpectedly, the next turn spawns with `--resume <id>`. Idle for 20 minutes means close; the next turn resumes. Browser reloads simply re-subscribe: the bridge keeps a transcript buffer of `AgentEvent`s per session and replays it.

**Interrupt.** First try the stream-json control interrupt request that the Agent SDK uses. If the turn has not ended within 1.5 s, terminate the process tree and mark the session for resume. Task 2.4 is a spike that confirms the control message on 2.1.303 before relying on it.

**Turn transaction.** On turn start the bridge opens a scene transaction labelled with the request text (truncated to 60 characters). Every `aex` tool op appends to it, and it commits on `turn.end` or stop. Ops are applied and broadcast immediately, so the user watches the model change live, while undo still treats the turn as one step.

**Scene tools** (MCP server `aex`, registered with zod 4 schemas): `get_scene_summary`, `get_elements`, `get_user_context`, `create_elements`, `update_elements`, `delete_elements`, `set_selection`, `capture_view`, plus `approve_tool` (permission prompt). `capture_view` asks the connected viewer over WebSocket for a PNG (`toBlob`, longest side 1280) with a 5 s timeout and returns it as MCP image content.

**Approval broker.** `approve_tool` receives `{ tool_name, input }`. If the tool is pre-approved (`mcp__aex__*`, or in the project's always-allow list stored in `.aex/settings.json`), it allows immediately. Otherwise it creates a pending approval, pushes a card to the web, and awaits a decision (click, or nod/shake from the gesture stream when exactly one card is pending) or a 60 s timeout. It returns the allow/deny JSON that the permission prompt tool contract expects. Rejected: `--permission-mode bypassPermissions` (silently allows everything); `--permission-prompts none` (silently denies everything the user installed).

**Extensions.** The loaded list comes from the stream-json `init` event (MCP servers with status, tools, skills or slash commands), so the UI shows what the session actually loaded rather than what config files claim. Add and remove project servers by running `claude mcp add|remove --scope project ...` in the project folder (no hand-editing of Claude Code's formats). Install skills by copying a folder, or `git clone --depth 1` into a temp dir, then validating `SKILL.md` front matter and copying into `<project>/.claude/skills/<name>/`. After any change: close the session and spawn with `--resume`.

**Secrets.** Env and header values are masked in the UI and passed straight to `claude mcp add` arguments. The bridge logger redacts any value under `env`, `headers`, `token` or `authorization` keys. A CI check greps sources for credential paths (`.credentials.json`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`) outside tests and fails if any appear.

**System prompt addition** (`.aex/agent/system.md`, generated): units are mm, Z is up, use `aex` tools for scene work, call `get_user_context` when the user says "this", "that" or "here", and prefer short replies because they may be read on a HUD.

## Risks / Trade-offs

- [stream-json event shapes change between Claude Code versions] → One mapping module with fixture-based tests recorded from the installed version; detect version at start and warn when untested.
- [Approval prompts become noisy for common read-only tools] → Always-allow per project; ship a suggested default list the user can accept once.
- [User MCP servers slow down session start (up to 30 s MCP timeout)] → Show per-server status as it arrives; the scene tools work as soon as `aex` connects.
- [Interrupt via control message not available] → Fallback kill-and-resume keeps the behaviour within the 3 s bound.

## Open Questions

- Whether skills appear in the init event as their own list or only as slash commands on 2.1.303. Task 1.3 records a fixture and the mapping adapts; the spec does not change.
