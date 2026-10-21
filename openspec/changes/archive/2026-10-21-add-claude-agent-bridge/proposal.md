# Proposal

## Why

This is where the product becomes an agent experience. The user's own Claude, running from their own Claude Code install and plan, needs to see the scene, change it, and talk back inside the HUD. It must keep everything the user already set up in Claude Code (their MCP servers and skills), and the user must stay in control of what it is allowed to do.

## What Changes

- A long-lived agent session that drives the user's installed, self-logged-in `claude` CLI over stream-json, survives browser reloads, resumes after crashes and can be interrupted. Credentials are never touched.
- The user's Claude Code setup loads as usual: user-level and project-level MCP servers, skills and settings. The app adds its own scene tools on top.
- An MCP server inside the bridge exposing scene tools (read the scene, read the selection and what the user is pointing at, create, update and delete elements, capture the view as an image). Each agent turn becomes one undoable transaction.
- In-app tool approval: any tool call that is not pre-approved is shown in the HUD. The user allows or denies it by click, nod or shake, and can choose "always allow" for that tool in this project. Calls are denied if unanswered within 60 seconds.
- Extension management in the HUD: see which MCP servers and skills are loaded and their status; add or remove project-level MCP servers; install or remove project-level skills from a folder or a git URL. The session restarts and resumes the conversation to apply changes.
- An agent panel: streaming replies, tool calls as compact chips, approval cards, status, a typed input and a stop control.
- The bridge's local access rules become a tested spec: loopback only, session token, Origin allow-list, MCP endpoint behind the same token.

Out of scope: voice input (next change), Rhino tools (later), other providers such as Codex or Ollama (later, same interface), installing user-level MCP servers or skills (users keep doing that in Claude Code itself).

Demo clip (Week 6): "First agent edit": select a massing block by hand, type "add three floors of 3.5 m", watch the tool chips and the model update, then undo the whole turn with one press.

## Capabilities

### New Capabilities

- `agent-session`: lifecycle of the user's own Claude session: detection, start, reuse, resume, interrupt, crash recovery and credential boundaries.
- `scene-tools`: the MCP tools through which the agent reads and edits the scene, and the one-turn-one-transaction rule.
- `tool-approval`: how tool calls that are not pre-approved are put to the user and decided.
- `agent-extensions`: visibility and project-level management of MCP servers and skills available to the agent.
- `agent-panel`: the HUD surface for conversation, tool activity, status and stopping.
- `local-access-control`: who may connect to the bridge and its MCP endpoint.

### Modified Capabilities

None. `scene-model` is used through its existing requirements (transactions, shared selection).

## Impact

- `packages/agent-core`: `AgentProvider` interface and `ClaudeCliProvider`.
- `apps/bridge`: agent process manager, MCP endpoint (`@modelcontextprotocol/server` + `@modelcontextprotocol/node`), approval broker, extension manager, transaction-per-turn wiring.
- `apps/web`: agent panel, approval cards, extensions view.
- `packages/protocol`: agent event, approval and extension messages.
- New dependencies: MCP TypeScript SDK v2, `cross-spawn` (Windows-safe spawning).
- Requires the user to have Claude Code installed and logged in. The app detects this and explains what to do if not.
