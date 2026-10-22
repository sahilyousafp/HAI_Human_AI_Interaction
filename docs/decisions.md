# Decisions

Small technical decisions confirmed by experiment, with what was measured. Newest first.

## The name: HAI, Human AI Interface (2026-10-22)

The working name AEX (AEC Agentic eXperience) became **HAI, Human AI Interface**. The new name says what the project is (the interface between a person and their AI) without tying it to AEC, which is where it starts. The rename goes all the way down so the name and the identifiers never disagree: the `@hai/*` package scope, the `.hai` workspace folder, `HAI_*` environment variables, the `mcp__hai__*` tool names, `scene.hai.json` and `.haimesh` files.

- **Migration, not a break.** `apps/bridge/src/legacy.ts` carries an existing workspace and project over: `.aex` becomes `.hai` (entry by entry if `.hai` was already created), saved tool names follow the tool server's new name, and a project's scene file and assets are renamed on open. Assets keep their old binary magic (`AEXMESH1`), which the reader still accepts; new ones are written as `HAIMESH1`.
- **Not carried over:** `AEX_*` environment variables and a few browser-side view preferences (their keys changed). Rhino files exported earlier keep their `aex.*` user strings; nothing reads them.
- **Left alone:** archived OpenSpec changes keep the name they were written under, and the GitHub repository keeps its address.

## Mochi's team: agents as `claude -p --agent <name>` processes (2026-10-20)

**Question.** Can each agent of the team (Mochi and the specialists) be a separate Claude Code process that takes its prompt, tools and model from the project's `.claude/agents/<name>.md`?

**Experiment.** Claude Code 2.1.303 in an empty folder with `.claude/agents/mochi.md` (`model: sonnet`, `tools: Read, mcp__hai__get_scene_summary`) and `architect.md`. One stream-json turn ran with `claude -p --agent mochi`.

**Result.**

- The init event reported `model: claude-sonnet-5-5`, so `sonnet` resolves to Sonnet 5.5, and `tools: ["Read"]`. The MCP tool was not listed because no MCP server was configured in that test.
- The init event also lists every available agent by name, including the project's own, under `agents`.
- The reply came from the Mochi prompt.

**Decision.** Each agent runs as `claude -p --agent <name>` with the app's MCP config. HAI starts, tracks and identifies these processes itself, so Mochi can answer status questions while specialists work, as RhinoCopilot does. It does not use Claude Code's in-process subagents, which would keep Mochi busy during delegations. Whether a listed `mcp__hai__*` tool appears once the bridge's MCP server is configured is checked against the real bridge when building.

## Mochi's voice: Kokoro on WebGPU in full precision, with phonemize (2026-10-20)

**Question.** Can Mochi's replies be spoken in a natural voice on the laptop, within the project's licence rules?

**Licences.** The Kokoro-82M ONNX weights are Apache-2.0. The `kokoro-js` package is Apache-2.0, but it depends on `phonemizer`, which bundles eSpeak NG compiled to WebAssembly (`src/espeakng.worker.js`). eSpeak NG is GPL-3.0, so `kokoro-js` cannot ship here. `phonemize` 2.0.1 (MIT, pure JavaScript, rule-based English with a 125,000-word lexicon, MIT dependencies) replaces it. The model is driven directly through transformers.js (`StyleTextToSpeech2Model`).

**Experiment.** Three Mochi-style sentences in Edge on the reference laptop (Intel Arc 140T, 16 cores). Intelligibility was checked by transcribing each generated clip with the app's Moonshine recogniser.

| Model and backend | Download | Time for 2.4 s / 4.5-5 s of speech (warm) | Heard back |
|---|---|---|---|
| int8, WebAssembly (single thread) | 92 MB | 2.8-3.0 s / 5.4-6.0 s | correct |
| fp16, WebGPU | 163 MB | 0.5 s / 0.8 s | silence (half-precision overflow) |
| fp32, WebGPU | 325 MB | 1.1 s / 2.1-2.3 s | correct |

- `phonemize` puts stress marks before a syllable. Kokoro expects them before the vowel, as espeak and misaki do. Moving them before the vowel turned garbled names ("Emoichi here, a product...") into near-perfect round trips ("Mochi here, product is working on the bench and reviewer is idle"). Kokoro's vocabulary also lacks `ɫ` and `ɝ`, which map to `l` and `ɜɹ`.
- A multi-threaded WebAssembly run with cross-origin isolation (COOP/COEP headers) did not finish within five minutes and was not pursued.

**Decision.** Where WebGPU is available, the fp32 model runs on WebGPU, faster than real time and sentence by sentence. It is a one-time 325 MB download by `pnpm assets`. Without WebGPU, replies use a local system voice, because the int8 WebAssembly path is slower than real time.

## Speaking to the team: how Moonshine hears the agent names (2026-10-20)

**Experiment.** Synthesised phrases (`test-assets/speech/*.wav`), transcribed by the app's worker.

| Said | Heard |
|---|---|
| "Architect, add a stair core here." | "Architect, add a stair core here." |
| "Mochi, ask Climate to run a winter shadow study." | "Machi: ask climate to run a Winter shadow study" |
| "Product, design a bench for the courtyard." | "Product: Design a bench for the courtyard" |
| "Reviewer, check the floor heights." | "Review or check the floor heights" |
| "Mochi, what is everyone doing?" (trimmed) | "Maci, what is everyone doing?" |

The same "Mochi" clip with a second of silence before it and three after came back empty every time. Live requests reach Moonshine trimmed by voice activity detection (300 ms of pre-speech padding), so this affects only untrimmed test input.

**Decision.** Names are matched on the first one or two words, against each agent's name and aliases, allowing one edit. The default aliases include these mishearings ("machi", "maci" for Mochi, "review or" for Reviewer). Users can add their own in `.hai/agents.json`. Voice-routing tests feed trimmed audio.

## On-device speech: Moonshine base int8 on WebAssembly, not WebGPU (2026-10-20)

**Question.** Where should the Moonshine speech model run in the browser to stay under one second from the end of speech to the transcript?

**Experiment.** Moonshine base ONNX, int8 files (encoder 20.5 MB, merged decoder 42.5 MB), transformers.js 4.3.1 in a Web Worker in Edge, on the reference laptop (Intel Arc 140T, 16 cores). The fixture "Make this wall three hundred thick" (2.8 s of audio) was transcribed four times after loading.

**Result.**

| Backend | Model load | First transcript | Warm transcripts |
|---|---|---|---|
| WebGPU | 1.75 s | 2.75 s | 2.0-2.1 s |
| WebAssembly | 1.45 s | 0.26 s | 0.20-0.22 s |

Both produced the same text, "Make this wall 300 thick". WebGPU has to unpack int8 weights on every run; it would only be faster with the fp16 or fp32 files (200-250 MB).

**Decision.** The worker always uses WebAssembly with the int8 files. The model loads when the microphone opens, so it is usually ready by the time the user stops speaking. Code: `apps/web/src/voice/transcriber.worker.ts`.

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

**Experiment.** Claude Code 2.1.303 run by the bridge with `--permission-prompt-tool mcp__hai__approve_tool`, in a throwaway project. Three requests: read the scene with an `hai` tool, run `echo`, and run a command that writes a file. The last one was denied first, then allowed.

**Result.**

- The CLI calls the tool only when its own rules would ask the user. The `hai` scene tool and the read-only `echo` ran without a call. The file-writing command produced a call.
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
