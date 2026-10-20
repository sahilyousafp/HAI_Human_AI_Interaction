# Decisions

Small technical decisions confirmed by experiment, with what was measured. Newest first.

## Project MCP servers in print mode (2026-10-20)

**Question.** Claude Code asks before it uses servers from a project's `.mcp.json`. Do servers that the app adds with `claude mcp add --scope project` load in `claude -p`, or are they skipped until someone approves them in a terminal?

**Experiment.** Claude Code 2.1.303 in an empty folder. `claude mcp add --scope project probe -- node -e "process.exit(1)"` was run, then one stream-json turn. The `system/init` event was checked (it is not always the first line), once without and once with `--settings` approving the server.

**Result.**

- `claude mcp list` reports the server as "Pending approval".
- In print mode it loads anyway. The init event lists `{"name":"probe","status":"failed","source":"project"}` both with and without the approval setting. It failed only because this command exits.
- The init event has no error text for a failed server.
- `claude mcp add` writes `.mcp.json` exactly as given, with `--env` and `--header` values. It needs the name before those variadic options, and `--` before a stdio command's own flags.

**Decision.** No approval setting is written or passed. Servers added in the app go through `claude mcp add|remove --scope project` (code: `packages/agent-core/src/claude/extensions.ts`). The extensions view shows the status from the init event, and the error when a provider reports one.

## Tool approval: the permission prompt tool contract (2026-10-20)

**Question.** What does Claude Code send to the tool named by `--permission-prompt-tool`, and what must it answer?

**Experiment.** Claude Code 2.1.303 run by the bridge with `--permission-prompt-tool mcp__aex__approve_tool`, in a throwaway project. Three requests: read the scene with an `aex` tool, run `echo`, and run a command that writes a file. The last one was denied first, then allowed.

**Result.**

- The CLI calls the tool only when its own rules would ask the user. The `aex` scene tool and the read-only `echo` ran without a call. The file-writing command produced a call.
- The input is `{ tool_name, input, tool_use_id }`. For Bash, `input.command` is the command text.
- An answer of `{"behavior":"deny","message":"The user declined this tool call."}` reached Claude as that message. It did not run the command or retry.
- An answer of `{"behavior":"allow","updatedInput":<input>}` ran the command.

**Decision.** `approve_tool` returns exactly these shapes. The user's own Claude Code allow rules still apply first, so the app only shows a card for calls the user would have been asked about in a terminal. Code: `apps/bridge/src/agent/approvals.ts`.

## Bridge dev server: Node's watch mode, not `tsx watch` (2026-10-20)

**Question.** Why did `pnpm dev` sometimes start the web app but never the bridge ("Bridge offline"), with no error?

**Experiment.** Windows 11, Node 24.19, tsx 4.23.15, pnpm 10.34. A timing hook loaded with `--import` in the bridge process showed it reached our code 11-16 s after it started, or never. `tsx src/main.ts` started in about 1 s with stdin closed, piped or held open. `tsx watch` started in about 1 s when stdin was closed or a terminal. When stdin was a pipe, which is what `pnpm --parallel` gives each script, it took 11 s or longer, or never started.

**Cause.** `tsx watch` reads stdin (Return restarts the run) and starts the program as a child that inherits the same stdin. On Windows, a process that inherits a pipe while its parent has a read pending on it blocks at startup until that read completes.

**Decision.** `apps/bridge` runs `node --watch --watch-preserve-output --import tsx src/main.ts`. Node's watch mode does not read stdin. It restarts on changes to any imported file, and stops the old process with SIGTERM, which the bridge handles. Measured under `pnpm dev`: it started in 2 s and restarted cleanly after edits.

## Stopping a Claude Code turn: the stream-json interrupt request (2026-10-20)

**Question.** Can the app stop a running `claude -p` turn over stream-json, without killing the process?

**Experiment.** Claude Code 2.1.303 (`claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`). A request that produces a long answer, then after 3 s this line on stdin:

```json
{"type":"control_request","request_id":"int-1","request":{"subtype":"interrupt"}}
```

**Result.**

- The CLI answered `{"type":"control_response","response":{"subtype":"success","request_id":"int-1",...}}` at once.
- The turn ended 12 ms after the request with a `result` of subtype `error_during_execution`, `terminal_reason` `aborted_streaming`.
- The same process then answered the next request normally: the session survives an interrupt.
- The init event advertises the capability as `interrupt_receipt_v1`.

**Decision.** Stop sends the interrupt request and maps the following `result` to a turn that ended "stopped" (not an error). If the turn has not ended within 1.5 s, the process is ended and the next request resumes the conversation with `--resume` in a new process. Either way the turn stops well within the 3 s requirement. Code: `packages/agent-core/src/claude/provider.ts` (`ClaudeCliSession.interrupt`).
