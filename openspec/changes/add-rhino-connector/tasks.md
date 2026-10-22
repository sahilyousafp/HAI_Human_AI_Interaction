# Tasks

## 1. Bridge side

- [ ] 1.1 Add Rhino protocol messages (hello client "rhino" with Python status, camera delta, pointer, pick result, selection, redrawn, Python run request and result) and the new tool names in `packages/protocol`; verify schema unit tests
- [ ] 1.2 Accept token-only connections without Origin for `client: "rhino"` and write the user-profile discovery file with a user-only ACL; verify "Rhino plugin connects", "token-less local client rejected" and "discovery file lifecycle"
- [ ] 1.3 Add `activeHost` shared state, routing of navigation and pointer messages, and fallback to the web host on disconnect; verify with a fake Rhino client in bridge tests
- [ ] 1.4 Mirror Rhino selection into the bridge and include Rhino pointed object and selection in `get_user_context`; verify "mouse selection mirrored" (fake client) and "'this' in Rhino"

## 2. Plugin core (no Rhino needed)

- [ ] 2.1 Create `plugins/rhino` with `HAI.Rhino.Core` (camera math, message models) and xUnit tests; verify turntable orbit, clamp, zoom and pan tests pass with `dotnet test`
- [ ] 2.2 Add `# r:` requirement-line parsing and Python result shaping (output cap at 20 000 characters, `result`, error with the end of the traceback) to the core library; verify unit tests for "output is capped", "output and result come back" and "a package is listed for approval"
- [ ] 2.3 Add the plugin project (`net48;net7.0`, RhinoCommon 8.x compile-time reference) with `HaiConnect` and `HaiDisconnect`; verify it builds for both targets
- [ ] 2.4 Add the C# job to CI on windows-latest (`dotnet test` for the core library, build for the plugin); verify it runs green

## 3. Plugin behaviour (manual in Rhino)

- [ ] 3.1 Implement connect, discovery, reconnect within 5 s and the command-line messages; verify "connect", "bridge not running" and "bridge restart" by the manual script
- [ ] 3.2 Apply coalesced camera deltas on the UI thread and send redraw acks; verify "orbit in Rhino" and that the HUD shows the Rhino latency p90
- [ ] 3.3 Draw the cursor ring and hover highlight with a display conduit, pick at up to 15 Hz and select on tap; verify "tap selects a Rhino object"
- [ ] 3.4 Send selection changes debounced at 50 ms; verify selection appears in the HUD within 200 ms

## 4. The Python workbench (works with Rhino closed)

- [ ] 4.1 Find a Python 3.10+ (the `py` launcher, then `python`), create the managed environment in `.hai/python` and install the starting packages through an injectable installer; verify bridge tests for "first use", "no Python on the machine" and a failed install
- [ ] 4.2 Add the `python_run` tool: a subprocess in the project folder, output cap, `result`, error and traceback, time limit, Stop ends the process within 3 s; verify "a script runs and answers", "works without Rhino", "an error is returned" and "stop" against a real environment (skipped where no Python is installed)
- [ ] 4.3 Add approval for the workbench (card with the script and the packages, packages requested through an explicit argument, always allow per project that never covers a new package); verify "a new library", "denied" and "always allow does not cover a new package" with the fake agent
- [ ] 4.4 Keep every run as a script in `.hai/scripts` with its header; verify "a run is kept" and that the folder is git-ignored
- [ ] 4.5 Offer **Import into viewer** (the existing importer) and **Open in Rhino** when a run writes a `.3dm`; verify "import a written file", "files are written directly" (`rhino3dm` writes and reads a box) and "the scene is untouched" in an E2E with the fake agent

## 5. Python in the open Rhino document

- [ ] 5.1 Spike: in Rhino 8, find how the plugin runs Python 3 in process with output and error capture, cancellation and `# r:` requirement lines (the `Rhino.Runtime.Code` scripting API, or a temporary script through Rhino's Python command), and measure the overhead of a trivial script; record the choice and numbers in `docs/decisions.md`; verify the note names the API and the measured overhead, and that cancel works or does not
- [ ] 5.2 Implement the runner in the plugin: UI thread, one undo record per run, result and error answer, time limit; verify "a script changes the document", "a Python error is returned, not thrown", "one undo reverts a run" and "time limit" by the manual script, with the shaping covered by the unit tests of 2.2
- [ ] 5.3 Report Python status in the hello and on change; verify "Python ready" and "Python unavailable" in bridge tests with the fake Rhino client, and by the manual script
- [ ] 5.4 Add `rhino_run_python` and `rhino_get_document` to HAI's MCP server (run asks for approval and shows the script and its `# r:` packages; read is pre-approved) and the per-role tool lists; verify "a run waits for the user", "a package is listed for approval", "read the document" "roles get their tools" / "Reviewer cannot run Python", and "a run is kept" for a Rhino run, with the fake Rhino client and fake agent
- [ ] 5.5 Show Python status in the HUD with what to do when unavailable, and the Python tool chip timing; verify the E2E with the fake Rhino client and that a trivial script's overhead stays under 500 ms in the bridge test

## 6. Web side

- [ ] 6.1 Add the host switch and Rhino connection status; verify "switch to Rhino" E2E with the fake Rhino client
- [ ] 6.2 Show the code (full and scrollable) and the packages on the approval card; verify "the card shows the script and the packages" by E2E and a Playwright screenshot in light and dark

## 7. Docs

- [ ] 7.1 Write `docs/rhino.md` (install the plugin, `HaiConnect`, Python in Rhino, the Python workbench and its libraries, runs as scripts, approvals, that nothing is sandboxed, performance tips); verify the steps on a clean Rhino 8 profile and a machine with and without Python

## 8. Demo

- [ ] 8.1 Write `demos/13-rhino.md` (connect, orbit and zoom by hand, point and tap-select a massing, ask the agent for a sun-hours study with Ladybug, then the same study from the saved `.3dm` with Rhino closed, record Rhino latency p90) and record the clip; verify on the maintainer's Rhino 8
