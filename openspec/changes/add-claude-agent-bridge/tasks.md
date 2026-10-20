# Tasks

## 1. Provider core

- [x] 1.1 Define `AgentProvider`, `AgentSession` and the `AgentEvent` union in `packages/agent-core` and `packages/protocol`; verify schema unit tests
- [x] 1.2 Implement detection (`where claude`, `claude --version`, `claude auth status --json`); verify unit tests with stubbed processes for "CLI missing" and "not logged in"
- [x] 1.3 Record stream-json fixtures from the installed CLI (init, partial text, tool use, tool result, result) into `packages/agent-core/fixtures`; verify fixtures are redacted of any account identifiers
- [x] 1.4 Implement `ClaudeCliProvider` (cross-spawn, line-buffered NDJSON parser, event mapping); verify mapping unit tests against the fixtures

## 2. Session lifecycle

- [x] 2.1 Implement one-process-per-project sessions with session id persistence and transcript replay; verify "second turn reuses the process" and "browser reload" with an integration test using a fake CLI script
- [x] 2.2 Implement crash recovery with `--resume`; verify the "agent process crash" scenario with the fake CLI
- [x] 2.3 Generate `.aex/agent/mcp.json` and `system.md` per project; verify the "units honoured" scenario with a live-CLI test marked manual in CI
- [x] 2.4 Spike: confirm the stream-json interrupt control message on 2.1.303 and record the result in `docs/decisions.md`; implement interrupt with kill-and-resume fallback; verify "stop mid-turn" within 3 s using the fake CLI

## 3. Access control and MCP endpoint

- [x] 3.1 Mount the MCP streamable HTTP endpoint on the bridge with bearer-token check; verify "MCP request without token" and the loopback and origin scenarios in unit tests
- [x] 3.2 Implement read tools (`get_scene_summary`, `get_elements`, `get_user_context`); verify "summary of the sample scene" and "pointed element reported" with an MCP client test
- [x] 3.3 Implement write tools with batch validation and atomic failure; verify "invalid batch is atomic"
- [x] 3.4 Wire turn transactions (open on turn start, append ops, commit on end or stop); verify "undo a whole turn"
- [x] 3.5 Implement `capture_view` via the viewer (PNG, longest side 1280, 5 s timeout); verify both capture scenarios E2E

## 4. Tool approval

- [x] 4.1 Implement the approval broker and the `approve_tool` permission prompt tool with pre-approval rules; verify "scene edit runs without a prompt" and "shell command needs approval" with the fake CLI
- [x] 4.2 Add approval cards in the web with Allow, Deny and Always allow; wire nod and shake when exactly one card is pending; verify "nod allows" and "shake denies" E2E with injected gesture events
- [x] 4.3 Implement the 60 s timeout and the project always-allow list with revoke in settings; verify "timeout" (with fake timers), "remembered approval" and "revoke"

## 5. Extensions

- [x] 5.1 Show loaded MCP servers (scope, status, error) and skills from the init event; verify "failed server is shown" with a fixture containing a failed server
- [x] 5.2 Add and remove project MCP servers through `claude mcp add|remove --scope project`, with masked secrets; verify "add a stdio server", "remove a server" and "masked header" (logs grep) in an integration test
- [x] 5.3 Install skills from folder or git URL with `SKILL.md` validation, and remove skills; verify "install from folder" and "invalid skill rejected"
- [x] 5.4 Restart and resume the session after any extension change; verify "conversation continues after adding a server"

## 6. Agent panel

- [x] 6.1 Build the panel: streaming transcript, tool chips with expandable details, status line, typed input; verify "streaming reply", "failed tool call", "working status" and "send typed request" E2E with the fake CLI
- [x] 6.2 Add the stop button and the two-palm stop gesture; verify "two-palm stop" E2E with injected gesture events

## 7. Safety checks and docs

- [x] 7.1 Add the CI credential-boundary check and log redaction tests; verify "no credential access in code" and "logs contain no secrets"
- [x] 7.2 Update `PROVIDERS.md` and write `docs/agent.md` (how the session runs, what loads, approvals, extensions); verify the documented spawn flags match the code by a unit test that imports the flag builder

## 8. Demo

- [ ] 8.1 Write `demos/06-first-agent-edit.md` (select a massing block by hand, ask for three floors of 3.5 m, show tool chips and live model change, undo the turn, show the extensions view with a user MCP server) and record the Week 6 clip; verify it runs against the real CLI on the maintainer's plan
