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

## Modelling NURBS without Rhino: what rhino3dm can do, and what it cannot (2026-10-23)

**Question.** Can the agent create NURBS geometry and save a `.3dm` with Rhino not installed, and can HAI's own viewer then draw it?

**Experiment.** Windows 11, Python 3.13, `rhino3dm` 8.35.0 in a fresh virtual environment, then `build123d` (OpenCascade) in another. A script built geometry, wrote a v8 `.3dm`, read it back, and the file was run through `convert3dm` (the importer in `apps/web/src/import/convert.ts`).

**Result.**

- Works: NURBS curves and surfaces from control points and knots, `Brep.CreateFromSurface`, `CreateFromRevSurface` (a revolved solid), cylinder and box extrusions, ruled surfaces, planar trimmed Breps (`CreateTrimmedPlane`), `Brep.CreateFromMesh`, transforms, layers and object names. The file reads back valid.
- Not exposed: loft, sweep, booleans, fillet, offset, Brep-Brep intersection, and meshing a Brep. The Brep face, loop and trim lists are read-only, so a trimmed Brep cannot be built from parts: only the static creators produce one.
- The importer only draws the render meshes a file stores for a Brep, so a Brep from `rhino3dm` is skipped ("no mesh") until a mesh is attached with `BrepFace.SetMesh(mesh, MeshType.Render)`. With meshes attached by evaluating the surface on a grid, a 5x5 cubic canopy (1152 triangles) and a revolved vase (3072) imported. An extrusion has no mesh either and was skipped. The vase's planar end caps were meshed as full squares, because a grid over the underlying surface ignores the trim: trimmed faces need a trim-aware mesher.
- `SetMesh` shares ownership of the mesh with Python: the process crashed (access violation) at interpreter shutdown even though the file was written. Ending with `os._exit(0)` after the write exits cleanly.
- `build123d` installed (736 MB with its OpenCascade wheel) but Windows Application Control blocked the unsigned OpenCascade DLL on this machine, so its booleans and fillets could not be run. A virtual environment under a long path also failed to install (the 260 character path limit); a short path worked.

**Decision.** Two modelling modes. Rhino 8 connected is the main way to model: it has the real kernel, meshes, and trims. The Python workbench (`rhino3dm`) is the lightweight mode when Rhino is absent, for freeform surfaces, revolves, extrusions and planar shapes, and it ships a small helper that attaches meshes and ends the process cleanly. An OpenCascade kernel is not part of this change: it is 736 MB, can be blocked by Application Control, and cannot become native trimmed Breps because `rhino3dm` cannot build Brep topology (a STEP file would be the only exact exchange). Revisit it if users ask for booleans without Rhino.

## The Rhino plugin: C# in two projects, and what could be measured without Rhino (2026-10-24)

**Question.** How is the plugin built so that most of it can be tested without Rhino, and does the Rhino to HAI budget hold?

**Decision.** `plugins/rhino` has `HAI.Rhino.Core` (netstandard2.0: the wire messages, the change coalescer, the mesh asset writer, the Python requirement and result handling) and `HAI.Rhino` (`net48;net7.0`, the commands, the bridge client, the mirror of the document), plus xUnit tests that run on plain .NET. The core is the part with logic; the plugin is thin glue over RhinoCommon. The two languages meet in committed fixtures (`plugins/rhino/tests/fixtures`): the C# tests write the messages the plugin sends and a mesh asset and compare them with the files, and `scripts/rhino-plugin-contract.test.mjs` reads the same files with the bridge's zod schemas and HAI's mesh reader, so a change on either side that breaks the other fails a test. This already found one defect: a very long error, once cut, plus its "left out" marker was over the 10 000 characters the bridge accepts for one.

**Measured (the stand-in plugin, the development laptop, the dev build of the web app).** A 50-object edit with every mesh replaced was drawn at a Rhino to HAI p90 of 215 to 344 ms at first, over the 300 ms budget. The cause was not the network (the 50 fetches were done in about 70 ms) but the web app redrawing everything on every mesh that arrived: the whole app and the whole viewer re-rendered once per mesh and per batch. Subscribing each mesh to its own asset, giving the top bar a status that only changes when what it shows changes, and telling the viewer once per frame brought the p90 to 80 to 115 ms. A unit test pins that an edit leaves the status object unchanged. The figure excludes the time Rhino spends meshing (the plugin stamps a batch when it sends it); the demo will record the real one.

**Constraints met on the way.**

- RhinoCommon on NuGet has a `net7.0` build only from 8.19 on; the plugin compiles against 8.19.25132.1001 for both targets and uses only long-standing APIs. RhinoCommon and Newtonsoft.Json are compile-time references that Rhino supplies at run time, and neither is shipped.
- Windows Smart App Control, on this machine, blocks freshly built unsigned .NET assemblies after their first run, so the C# tests ran once from a new build and were then refused (as the OpenCascade DLL was). The compile, the TypeScript contract test and the CI job (windows-latest, no such policy) are not affected; locally, a rebuild gets another run.
- The plugin's Python runner is not written: how to run Python 3 in process with output capture, cancellation and `# r:` lines (task 5.1) has to be found on a real Rhino 8. Until then the plugin reports Python as unavailable and answers a run request with an error, so the agent uses the workbench.

## Does the real agent offer a panel on its own? A live run says not yet (2026-10-24)

**Question.** Task 7.1 of `add-generated-panels`: with the signed-in Claude Code CLI and no hint, does the agent offer a panel for "about 150 millimetres of clearance between col-a1 and the north wall, with a tolerance. Let me tune it."?

**Experiment.** `HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/panel-live.spec.ts`, three runs on the maintainer's plan (each about 4 minutes before the offer was given up on), changing the wording between runs.

**Result.**

- Run 1, as the tools were: Mochi handed Architect "move col-a1 to 150 mm from the north wall" and left out "let me tune it". Architect moved the column and set a tolerance property. No offer.
- Run 2, after the `delegate` description told the lead to quote the user's words: Mochi did pass "tune it yourself" on, but Architect stored `clearance_mm` and `clearance_tolerance_mm` as properties of the column and told the user where to change them. No offer.
- Run 3, after the specialists' default prompt and the `offer_panel` description said to offer a panel first when the user wants to tune values: Architect reported "there are no sliders, you can only tune the value as properties". No offer.

**Decision.** The wording changes stay (they are correct, and the first one fixed a real loss of the user's intent between the lead and the specialist), but they are not enough: a real specialist does not reach for `offer_panel` unprompted. Not yet known is whether it sees the tool at all (Claude Code may defer a long list of MCP tools behind its tool search) or sees it and chooses not to. The next step is to read Architect's own session transcript from a live run, and then either name the panel tools in the specialist prompt, or let the lead offer the panel itself. Until then the generated panel is reliably reached by asking for it ("build me a panel for this"), which the fake-CLI tests cover, and the live check stays unticked.

## Parallel modelling: claims in the bridge, tags on the elements, scripts checked afterwards (2026-10-24)

**Question.** How can several agents change one model at the same time without a person having to referee?

**Decision.** Planned scopes, enforced where the model changes. A task carries a scope (ids, a part, a region); no scope is the whole model, so every old project, edited agent and hand-typed request keeps the one-writer behaviour. The claim table lives in the bridge, in memory, tied to the task (no leases or heartbeats: the holder and the checker are one process and the task has a lifecycle). Every create, update, delete and tag change goes through `Team.vet`, which stamps what the agent makes with `hai.owner` and `hai.part`, refuses any write to a `hai.` tag, and checks the whole batch against the agent's claim and everyone else's (a stale holder is refused because the resource checks, not because it behaves). Parts are tag values, not an entity, so there is nothing to keep in step; tags are optional on elements, so old projects load. Each agent's work is its own undo group; disjoint claims make the groups commute, so the existing linear history stays correct. Python outputs are reserved per task; a Rhino script is queued, stamped by the plugin and compared before and after, and the result says plainly that this cannot prevent a change.

**Rejected.** Optimistic concurrency with base revisions (a conflict shows up after the model has spent its tokens, and it does nothing for two agents making conflicting implicit decisions: the shared brief does that); auto-borrowing on first edit alone (kept as `request_claim`); CRDTs or branch and merge (geometry has no meaningful automatic merge and there is already one authority); sandboxing scripts; refusing a Rhino script that "looks" out of scope by reading its code (undecidable, false comfort).

**Measured.** Checking 100 elements in a model of 5000 against three claims is well under the 5 ms budget; a claim reaches the agent panel at a 90th percentile of 44 ms over 8 runs (budget 200 ms). Making the bridge close its open connections on stop took a test's teardown from 4 s to 9 ms: an agent's MCP stream stayed open until it timed out.

**Not verified.** The plugin's stamp and diff compile and the diff is unit-tested, but they have not run in a real Rhino 8 (the Python runner does not exist yet); the live check that a real Mochi splits a request into non-overlapping scopes with a brief is still to do.

## Agents' own cameras: the viewer's renderer, one step per picture (2026-10-25)

**Question.** How can several agents look at the model from different sides to check their work, without taking the user's camera or showing the user's own state?

**Decision.** Each agent places named cameras that are only numbers in the bridge (`AgentEyes`), and the viewer page draws a picture from one with its own renderer: a second camera, one synchronous step that draws, copies the canvas and draws the user's frame again, so the browser never paints the agent's view. What is only the user's (hover, selection and deletion colours, the section cut, tool marks, claim boxes, camera markers) is tagged in the scene and put aside for the step. The infinite grid follows the user's camera from frame to frame, so it is re-centred under each picture's camera (found when a picture taken after a selection differed from one taken before it). Pictures are asked of one viewer, the one the user used last. A sun study takes its pictures in its own light.

**Rejected.** A `WebGLRenderTarget` (no tone mapping in render targets, so pictures would not match the model on screen); a second `WebGLRenderer` (duplicates every GPU buffer); a renderer in the bridge (a second GL stack and a copy of the geometry); drawing into the user's canvas across a paint (a visible flash).

**Measured.** On a laptop with a GPU: four 1024-pixel pictures 204 ms (90th percentile over 10 runs), a set of eight 312 ms, and the longest gap between the user's own frames while a set was taken 17 ms. A picture taken from a camera, with the user mid-drag, left the user's camera, canvas and selection exactly as they were.

**Not verified.** A live run with the real Claude Code to see whether Architect uses the cameras unprompted after its changes (`demos/18-agent-eyes.md` has the checklist), and software-GL machines, where the budgets are relaxed in the test and not measured.

## Workers: sessions of the same agent, parts as sub-parts, a plan card instead of a plan panel (2026-10-25)

**Question.** How can one specialist split its own task into parts that are made at the same time, with the guarantees of the parallel-modelling change?

**Decision.** A worker is a session of the same agent that the app starts itself, under the name `<agent>.<n>` (a dot is accepted by the real Claude Code as an `--agent` name, checked), with its own token, its own claim cut from its specialist's, its own undo step and its own colour (its specialist's). The specialist's task runs until its workers have ended and hears each outcome as a turn of its own; stopping it, or its failing, stops them. Parts are hierarchical (`pavilion/dome` is inside `pavilion`), which gives a part claim something to be cut into; the claim rule became "the claim cut from yours holds its part", because the earliest-granted rule would have let a parent change its worker's part. The session limit (`maxSessions`, 6) counts live work and is the user's control over cost. Every agent may use Claude Code's own subagents, each read-only, because a subagent is indistinguishable from its parent at the tool server. Offers for panels wait behind an open panel instead of being refused, and Mochi shows a plan card before it hands out a split.

**Rejected.** Native subagents as the fan-out (one token for all of them, so no per-part claim, undo or display); a generated panel for the plan (`open_panel` has no way to return the user's choice to the agent, so Mochi could not learn which parts were kept); letting the parent and a worker share a part.

**Measured.** With the fake agent, two workers overlap in time and the specialist's task ends after both; stopping the specialist stops its workers and frees every claim in under 3 s, including a worker that ignores the interrupt (ended for it after 3 s); no process or file of a worker is left after a run. With the real Claude Code (`e2e/workers-live.spec.ts`, 2.1 minutes), asked for a hall and a pergola with workers, Architect started `architect.2` and `architect.3` with the sub-parts `pavilion/hall` and `pavilion/pergola` inside its claim `pavilion`, the two overlapped in time (started 2 s apart, ended 5 s apart), the specialist's task ended after both and it reported once, every element carried its worker as its owner, and the workers and Architect checked their work with their own cameras unprompted. The real CLI accepted the new `--agents` file with the read-only helper entries.

**Not verified.** A real helper subagent started by the real CLI (task 4.2), a worker's panel offer queuing behind its parent's panel with the real CLI (task 6.3), and how often the real model chooses to split without being asked to (`demos/17-workers.md` has the checklist).
