# The agent

AEX drives **your own Claude**: the Claude Code command-line tool you installed and signed in to yourself. It runs the unmodified `claude` program on your machine and talks to it over standard input and output, the way a terminal would. Your MCP servers, skills and settings load as usual; AEX adds its scene tools on top and shows everything in the agent panel over the model.

## Before you start

Install Claude Code and sign in once in a terminal by running `claude`. The bridge checks both with Claude Code's own commands (`claude --version`, then `claude auth status`, from which it reads only whether you are signed in). If either check fails, the panel says what is missing and what to do, and no session starts. The checks run again whenever the page connects, so after installing or signing in, reload the page.

## How the session runs

When you send the first request in a project, the bridge starts one long-lived process in the project folder:

```text
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --mcp-config <project>/.aex/agent/mcp.json --permission-prompt-tool mcp__aex__approve_tool --append-system-prompt-file <project>/.aex/agent/system.md --resume <session id>
```

`--resume` is only added when the project already has a conversation. A unit test checks that this command matches the code (`buildClaudeArgs` in `packages/agent-core/src/claude/provider.ts`).

- **One process per project.** Every request is a new turn for the same process, so the agent remembers the conversation. Opening another project starts that project's own conversation.
- **Files it writes**, all in the project's `.aex` folder, which is kept out of git:
  - `agent/mcp.json` adds only the app's own MCP server, `aex`, at `http://127.0.0.1:<port>/mcp`. It carries this bridge session's random token as a bearer header. That token protects the app's local endpoint; it is not a Claude credential.
  - `agent/system.md` is added to the system prompt. It says that lengths are millimetres, Z is up, scene work goes through the `aex` tools, and "this" or "that" means what you point at or select.
  - `agent/session.json` holds the conversation id, so the conversation survives restarts.
- **Reloading the page** shows the whole conversation again. The bridge keeps the last 50 turns.
- **If the process ends unexpectedly**, the next request starts a new one with `--resume`, and the turn shows "Session recovered".
- **After 20 idle minutes** the process is closed. The next request resumes the conversation.
- **Stop** (the stop button, or both open palms toward the camera for half a second) sends Claude Code's interrupt request. If the turn has not ended within 1.5 s, the process is ended and the next request resumes. Either way the turn ends within 3 seconds, and what it already changed stays as one undo step.

## What the agent can do in the scene

The `aex` MCP server gives the agent these tools:

| Tool | What it does |
|---|---|
| `get_scene_summary` | Levels, element counts by type and the bounding box, in millimetres |
| `get_elements` | Full details by id, or by type and level |
| `get_user_context` | The selection, the element under your hand pointer, and the camera |
| `create_elements`, `update_elements`, `delete_elements` | Change the scene. Each batch is checked as a whole: if one element is invalid, nothing changes and the error names it |
| `set_selection` | Select elements for everyone |
| `capture_view` | A PNG of what you see in the viewer, at most 1280 px on its longest side |

**One request is one undo step.** Everything the agent changes while answering one request is a single transaction labelled with your request. You watch the model change as it works, and one Undo reverts the whole turn.

## Approvals

Some tool calls need your say-so.

- **The scene tools run without asking**, because every change shows in the model and can be undone.
- **Your own Claude Code rules apply first.** Anything your Claude Code settings already allow, and read-only commands Claude Code considers safe, run without a card. A card only appears for a call you would have been asked about in a terminal.
- **Everything else shows an approval card** in the turn, under the tool's chip. The card shows the tool, where it comes from (Claude Code itself or the MCP server's name), and the command, path, URL or input.
  - **Allow** with a click, or by nodding while engaged.
  - **Deny** with a click, or by shaking your head. Claude is told you declined.
  - Head gestures only decide a card while it is the only one waiting.
  - A shake that answers a card does not also cancel the active tool.
- **Unanswered cards are denied after 60 seconds**, and the card says it timed out.
- **Always allow** pre-approves that tool in this project, kept in `.aex/approvals.json`. Remove it under **Agent permissions** in the sidebar, and the next call asks again.

## Extensions

The **Extensions** tab in the agent panel shows:

- **What the session loaded**: every MCP server with its scope (user, project, plugin, claude.ai, or this app) and status (connected, failed, pending, needs-auth), and the skills. This comes from the session itself, so it shows what really loaded, not what config files claim. It appears after the first request.
- **MCP servers in this project.** You can add a server that runs a command (stdio) or one at an HTTP URL, and remove servers.
  - AEX runs `claude mcp add --scope project` and `claude mcp remove --scope project` in the project folder. The server goes in the project's `.mcp.json`, so it also works when you run Claude Code there yourself.
  - Environment variable and header values are typed into hidden fields. They are passed straight to `claude mcp add`, never shown again (only their names, masked), never sent back to the browser, and never logged.
- **Skills in this project.** You can install a skill from a folder, or from an https git repository (cloned shallowly), and remove skills.
  - The folder must contain a `SKILL.md` with a `name` and a `description` in its front matter, or installation stops with the reason and nothing is copied.
  - Skills are copied to `.claude/skills/<name>/` in the project.

After any change the agent process restarts and resumes the same conversation, so the change applies from your next request.

User-level servers and skills stay yours to manage in Claude Code itself.

## Using the panel

- **Speak** is the main way to ask: press the microphone button (or hold the **`** key) and say what to change while you point at the model. The transcript is sent after 1.5 s, or at once with a nod or **Enter**; a shake or **Escape** discards it. See [voice.md](voice.md).
- Or type a request and press **Enter** to send it (**Shift+Enter** adds a line). You can send while the agent is ready; while it works, the send button becomes **Stop**.
- **Ask agent** in the tool palette (or the **A** key) opens the panel and starts listening.
- Replies stream in as they are written. Each tool call is a chip showing running, needs approval, done, failed or denied. Click a chip to see its input and its result or error.
- The status shows Not available, Starting, Ready, Working or Recovering.
- Collapse the panel with its arrow button. While collapsed, it shows how many approvals are waiting.

## Privacy and logs

- The bridge only ever starts `claude` and exchanges messages with it. It never reads Claude's credential files, tokens or keys. A CI check (`pnpm credentials:check`) fails if any shipped source refers to them.
- The bridge logs one line per event: session started, turn ended, approval decided, extension changed. Every logged detail is redacted first: environment variables, headers, tokens and bearer values are replaced, and so is the session token. A test runs a full turn with an approval and a secret header and checks that the log contains neither.
- Claude Code's own error output is never echoed.

## Troubleshooting

| What you see | What to do |
|---|---|
| "Claude Code is not installed." | Install it, then reload the page |
| "Claude Code is not logged in." | Run `claude` in a terminal and log in, then reload the page |
| "Claude Code is installed but did not start." | Run `claude --version` in a terminal to see what is wrong |
| A server shows "failed" | Check its command or URL in the Extensions tab; remove and add it again with the fix |
| A card timed out | Ask again; or choose Always allow if you trust that tool in this project |
| "Session recovered" | The agent process ended unexpectedly and the conversation was resumed; nothing to do |
