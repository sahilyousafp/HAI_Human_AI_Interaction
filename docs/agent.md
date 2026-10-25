# The agent

HAI drives **your own Claude**: the Claude Code command-line tool you installed and signed in to yourself. It runs the unmodified `claude` program on your machine and talks to it over standard input and output, the way a terminal would. Your MCP servers, skills and settings load as usual; HAI adds its scene tools on top and shows everything in the agent panel over the model.

## Before you start

Install Claude Code and sign in once in a terminal by running `claude`. (The desktop app does both from its first-run screen, see [desktop.md](desktop.md).) A `claude` that is installed but not on the PATH is found in `%USERPROFILE%\.local\bin`, where Anthropic's installer puts it. The bridge checks both with Claude Code's own commands (`claude --version`, then `claude auth status`, from which it reads only whether you are signed in). If either check fails, the panel says what is missing and what to do, and no session starts. The checks run again whenever the page connects, so after installing or signing in, reload the page.

## How the session runs

HAI runs a small team of agents, each its own Claude Code session (see [agents.md](agents.md)). When an agent first has work in a project, the bridge starts one long-lived process for it in the project folder:

```text
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --mcp-config <project>/.hai/agent/<name>/mcp.json --permission-prompt-tool mcp__hai__approve_tool --append-system-prompt-file <project>/.hai/agent/<name>/system.md --agent <name> --agents <project>/.hai/agent/<name>/agents.json --resume <session id>
```

`--agent` names the team member the process runs as (see [agents.md](agents.md)). `--agents` points at the definition HAI runs that agent with: the project's `.claude/agents/<name>.md` (its prompt, model and your own tools such as Read or your MCP servers) with HAI's own tools taken from the agent's role instead of the file, because Claude Code hides every tool a definition's `tools:` line does not list, and a file written by an earlier HAI never lists the tools added since (`python_run`, the panel tools). A conversation is resumed only under the same set of tools, so an agent that was told earlier that it cannot do something starts fresh once it can; `--resume` is only added when that agent already has a conversation. A unit test checks that this command matches the code (`buildClaudeArgs` in `packages/agent-core/src/claude/provider.ts`).

- **One process per agent.** Every request to Mochi, and every task for a specialist, is a new turn for that agent's process, so each agent remembers its conversation. Opening another project starts that project's own conversations.
- **Files it writes**, all in the project's `.hai` folder, which is kept out of git:
  - `agent/<name>/mcp.json` adds only the app's own MCP server, `hai`, at `http://127.0.0.1:<port>/mcp`. It carries a random token issued to this process as a bearer header, and a new one each time the process starts. From the token the bridge knows which agent is calling and offers it only the `hai` tools its definition lists, so Reviewer has no write tools at all. The browsers' session token is not accepted there. These tokens protect the app's local endpoint; they are not Claude credentials.
  - `agent/<name>/system.md` is added to the system prompt. It says that lengths are millimetres, Z is up, scene work goes through the `hai` tools, and "this" or "that" means what you point at or select. Mochi's also lists the specialists it can hand work to, from their definitions.
  - `agent/<name>/session.json` holds the agent's conversation id, so its conversation survives restarts.
  - It also holds the version of the instructions HAI gave the agent when the conversation started (the base prompt and what Mochi is told the team can do). When an update to HAI changes those instructions, a conversation from the older version is **not resumed**: the agent starts a new one, because an agent resuming its old conversation keeps to what it said before ("we can only make walls") whatever its new instructions say. The old conversation stays in Claude Code's own history; the bridge log says "saved conversation not resumed". Conversations in files from before this existed are treated as older.
  - The team's definitions are Claude Code agent files in `.claude/agents/`, with HAI's extra details in `.hai/agents.json` ([agents.md](agents.md)).
- **Reloading the page** shows every agent's conversation again. The bridge keeps the last 50 turns of each.
- **If the process ends unexpectedly**, the next request starts a new one with `--resume`, and the turn shows "Session recovered".
- **After 20 idle minutes** an agent's process is closed. Its next turn resumes the conversation.
- **Stop** (the stop button, **Stop all**, or both hands clenched into fists and then opened toward the camera) sends Claude Code's interrupt request to every agent that is working; one task can be stopped on its own. If a turn has not ended within 1.5 s, the process is ended and the next turn resumes. Either way it ends within 3 seconds, and what it already changed stays as one undo step.

## What the agent can do in the scene

The `hai` MCP server gives each agent the tools its definition lists, from these:

| Tool | What it does |
|---|---|
| `get_scene_summary` | Levels, element counts by type, how many elements each owner and part holds, and the bounding box, in millimetres |
| `get_elements` | Full details, with tags, by id, or by type, level, owner, part or tag. An element you changed by hand since the agent last read it is marked `changedByUser` |
| `get_user_context` | The selection, the element under your hand pointer, and the camera |
| `create_elements`, `update_elements`, `delete_elements` | Change the scene. Each batch is checked as a whole: if one element is invalid, nothing changes and the error names it |
| `set_tags` | Sets or removes the agent's own tags on elements. Names starting with `hai.` (`hai.owner`, `hai.part`, `hai.source`) belong to the system and are refused (every agent that changes the model) |
| `set_selection` | Select elements for everyone |
| `confirm_plan` | Shows the user how the lead means to split a request (agent, title and scope of each part) before it hands anything out; the user removes parts and confirms, or skips, and the lead hands out only the confirmed parts (the lead only; see [agents.md](agents.md#workers)) |
| `spawn_worker` | Starts a worker for one part of the agent's own task (title, instruction, scope inside its claim): another session of the same agent, with its own undo step; the task ends after its workers (the specialists that change the model; see [Workers](agents.md#workers)) |
| `get_claims`, `request_claim`, `release_claim` | See who is working on which part of the model, ask for more scope for the running task, give some back (every agent; see [Parallel modelling](parallel.md)) |
| `capture_view` | A PNG of what you see in the viewer, at most 1280 px on its longest side |
| `python_run` | Runs a Python script in an environment HAI manages in the project (no Rhino needed). You see the whole script and the packages it would install first; every run is kept in `.hai/scripts`; a `.3dm` it writes can be imported into the viewer with one click (Architect, Product, Climate) |
| `rhino_run_python` | Runs a Python script inside your open Rhino 8 with all of RhinoCommon, as one undo step, after you have seen it. Only offered while Rhino is connected and the mode is not Python only (Architect, Product) |
| `rhino_get_document` | Reads Rhino's units, layers, object counts, selection and active view (every agent, while Rhino is connected) |
| `set_view` | Moves your camera: turn, tilt, nearer or further, look at a point, or frame elements. It changes nothing in the model (every agent) |
| `camera_set` | Places or moves one of your own cameras by name (direction, distance, target or elements to frame); it is private to you and never moves the user's view |
| `camera_list` | Lists your own cameras |
| `camera_capture` | Pictures from your own cameras or a preset (`iso`, `top`, `front`, `left`, `orbit-sheet`), taken off-screen without the user's hover, selection or section |
| `camera_delete` | Deletes one of your cameras, or all of them |
| `sun_study` | Sets the viewer's sun for a date, time and place and returns its altitude and azimuth with a picture (Climate) |
| `offer_panel`, `open_panel`, `update_panel`, `close_panel` | Offer you a small panel for a task, show it once you accept, replace it, close it (every agent that changes the model; see [Generated panels](#generated-panels)) |
| `delegate`, `team_status`, `cancel_task` | Hand a task to a specialist, see what everyone is doing, stop a task (Mochi) |

**One task is one undo step.** Everything a specialist changes in one task is a single transaction labelled with the agent and the task, for example "Architect: Stair core". You watch the model change as it works, and one Undo reverts the whole task. Agents given separate parts of the model work at the same time, each in its own undo step; a task with no scope takes the whole model and runs alone ([parallel.md](parallel.md)).

## Generated panels

Some requests are about numbers you want to feel out, not type once: a clearance between a wall and a column, a slab overhang within a tolerance. For those the agent can offer to write you a small panel.

- **The agent offers first.** It calls `offer_panel` with what the panel is for, and a card appears in the agent panel: "Open a tolerance panel?" with **Open** and **Skip**. Nod to open or shake to skip (the card is answered after a voice transcript under review and an approval card, see [gestures.md](gestures.md)). An offer nobody answers expires after 60 seconds and the agent is told.
- **Your nod is the consent.** A panel is never opened without an accepted offer, and one accepted offer allows exactly one panel. An offer is refused while another offer is waiting or a panel is open, so there is at most one panel at a time across all agents.
- **The panel shell appears at once** (within 150 ms of your answer) with a loading state, while the agent writes the panel with `open_panel`: one self-contained HTML document with a title and a size (at most 256 KB). The call returns `ready` as soon as the page loaded it, or the error if it did not, so the agent can fix it with `update_panel`. It does not wait for you to finish with the panel, so it never holds up the team.
- **Which agents.** The four panel tools go to every agent that changes the model (Architect and Product by default), whatever its definition file lists, so projects made before panels existed get them without any change. Mochi, Reviewer and Climate do not change the model, so Mochi hands the task to Architect or Product, which offers the panel. **Settings > Features > Generated panels** switches the tools off; an open panel then closes and drops its preview.
- **No approval card.** Your acceptance of the offer is the approval. A panel can only read the scene and send scene operations that are checked like every other edit.
- **When the panel closes** (Done, Close, Escape, or the agent closing it) the agent that opened it is told, as a short note, whether you kept the result. It arrives as a turn when the agent is idle, or right after the turn it is in, the way Mochi's reports do. An agent that closes its own panel is not told. A panel stays open when the agent's turn ends or is stopped.
- **An offer ends with its turn.** If the turn that made an offer ends or is stopped before you answer, or you accepted and the agent never supplied a panel, the card says "No panel was made".

### The panel's sandbox

A panel is code the agent wrote, so it runs in a sandboxed frame (the full list is in [SECURITY.md](../SECURITY.md#generated-panels)):

- It cannot read the app, its session token, storage or cookies, and it cannot call the bridge or the agent's tools.
- It cannot make any network request, load anything from outside itself (use `data:` URIs for images and fonts), open windows, submit forms, show dialogs, nest frames or navigate the app or itself. A panel whose frame tries to leave is ended.
- It sees the scene through `hai.scene.get`, hears about changes through `hai.on`, and sends scene operations with `hai.preview` and `hai.commit`. Each operation is checked like every other edit; an invalid one changes nothing and the panel is told which element and field. At most 60 messages per second are accepted, and a document is at most 256 KB.
- The header, **Done** and **Close** belong to the app: the document cannot hide, move or imitate them.
- A preview is drawn for you only. It adds no undo step, is not saved, and the agent does not see it. **Done** keeps it as one undo step labelled with the panel's title; **Close**, Escape and a lost connection put the model back.
- A panel that throws or never finishes loading shows **Failed** in its header with the reason, and the agent is told, so it can fix the document with `update_panel`.

## Approvals

Some tool calls need your say-so.

- **The scene tools run without asking**, because every change shows in the model and can be undone. So do the panel tools, because accepting an offer is the consent.
- **Your own Claude Code rules apply first.** Anything your Claude Code settings already allow, and read-only commands Claude Code considers safe, run without a card. A card only appears for a call you would have been asked about in a terminal.
- **Everything else shows an approval card** in the turn, under the tool's chip, naming the agent that asks. A specialist's card also waits under its hand-off chip in Mochi's chat. The card shows the tool, where it comes from (Claude Code itself or the MCP server's name), and the command, path, URL or input.
  - **Allow** with a click, or by nodding while engaged.
  - **Deny** with a click, or by shaking your head. Claude is told you declined.
  - Head gestures only decide a card while it is the only one waiting.
  - A shake that answers a card does not also cancel the active tool.
- **Unanswered cards are denied after 60 seconds**, and the card says it timed out.
- **Always allow** pre-approves that tool in this project, kept in `.hai/approvals.json`. Remove it under **Settings > Agent permissions**, and the next call asks again.

## Extensions

The **Extensions** tab in the agent panel shows:

- **What the session loaded**: every MCP server with its scope (user, project, plugin, claude.ai, or this app) and status (connected, failed, pending, needs-auth), and the skills. This comes from the session itself, so it shows what really loaded, not what config files claim. It appears after the first request.
- **MCP servers in this project.** You can add a server that runs a command (stdio) or one at an HTTP URL, and remove servers.
  - HAI runs `claude mcp add --scope project` and `claude mcp remove --scope project` in the project folder. The server goes in the project's `.mcp.json`, so it also works when you run Claude Code there yourself.
  - Environment variable and header values are typed into hidden fields. They are passed straight to `claude mcp add`, never shown again (only their names, masked), never sent back to the browser, and never logged.
- **Skills in this project.** You can install a skill from a folder, or from an https git repository (cloned shallowly), and remove skills.
  - The folder must contain a `SKILL.md` with a `name` and a `description` in its front matter, or installation stops with the reason and nothing is copied.
  - Skills are copied to `.claude/skills/<name>/` in the project.

After any change every agent's process restarts and resumes its conversation, so the change applies from the next request or task.

User-level servers and skills stay yours to manage in Claude Code itself.

## Using the panel

- **The panel talks to Mochi.** The team strip shows the specialists, hand-off chips open their work on a task, and the **Agents** tab edits the team ([agents.md](agents.md)). Mochi's replies are spoken.
- **Speak** is the main way to ask: press the microphone button (or hold the **`** key) and say what to change while you point at the model. The transcript is sent after 1.5 s, or at once with a nod or **Enter**; a shake or **Escape** discards it. See [voice.md](voice.md).
- Or type a request and press **Enter** to send it (**Shift+Enter** adds a line). You can send while the agent is ready; while it works, the send button becomes **Stop**.
- **Ask agent** in the tool palette (or the **A** key) opens the panel and starts listening.
- Replies stream in as they are written. Each tool call is a chip showing running, needs approval, done, failed or denied. Click a chip to see its input and its result or error.
- The status shows Mochi's state: Unavailable, Starting, Ready, Working or Recovering.
- Collapse the panel with its arrow button. While collapsed, it shows how many approvals are waiting.

## Privacy and logs

- The bridge only ever starts `claude` and exchanges messages with it. It never reads Claude's credential files, tokens or keys. A CI check (`pnpm credentials:check`) fails if any shipped source refers to them.
- The bridge logs one line per event: session started, turn ended, approval decided, extension changed. Every logged detail is redacted first: environment variables, headers, tokens and bearer values are replaced, and so are the session token and the agents' MCP tokens. A test runs a full turn with an approval and a secret header and checks that the log contains neither.
- Claude Code's own error output is never echoed.

## Troubleshooting

| What you see | What to do |
|---|---|
| "Claude Code is not installed." | Install it, then reload the page. In the desktop app, the first-run screen (or Settings > Setup) can install it for you ([desktop.md](desktop.md)) |
| "Claude Code is not logged in." | Run `claude` in a terminal and log in, then reload the page. In the desktop app, the first-run screen opens the sign-in window for you |
| "Claude Code is installed but did not start." | Run `claude --version` in a terminal to see what is wrong |
| A server shows "failed" | Check its command or URL in the Extensions tab; remove and add it again with the fix |
| A card timed out | Ask again; or choose Always allow if you trust that tool in this project |
| "Session recovered" | The agent process ended unexpectedly and the conversation was resumed; nothing to do |
