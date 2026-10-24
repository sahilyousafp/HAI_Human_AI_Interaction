# Tasks

## 1. Bridge side

- [x] 1.1 Add Rhino protocol messages (hello client "rhino" with Python status, object batches with descriptors and deletions, object select, selection, Python run request and result) and `view.set`, and the new tool names in `packages/protocol`; verify schema unit tests
- [x] 1.2 Accept token-only connections without Origin for `client: "rhino"` and write the user-profile discovery file with a user-only ACL; verify "Rhino plugin connects", "token-less local client rejected" and "discovery file lifecycle"
- [x] 1.3 Add the mirror table in the bridge (descriptors by Rhino id and the assets they use), the relay of batches to the web, a snapshot for pages that connect later, clearing on disconnect, and the mode in use (Automatic follows the connection); verify with a fake Rhino client "the mirror reaches a late page", "disconnect clears the mirror" and "an asset is uploaded before its descriptor"
- [x] 1.4 Mirror Rhino selection into the bridge and out again (`rhino.select`), and include the Rhino object under the HAI pointer and the Rhino selection in `get_user_context`; verify "mouse selection mirrored" and "'this' in Rhino" (fake client) and "a pick selects in Rhino"
- [x] 1.5 Add the `set_view` tool (azimuth, elevation, distance, target or element ids to frame), relayed to the viewer like `view.capture` and offered to every agent; verify "agent sets the view" unit tests through the MCP client and "every agent has set_view"

## 2. Plugin core (no Rhino needed)

- [x] 2.1 Create `plugins/rhino` with `HAI.Rhino.Core` (message models, the change coalescer, and the mesh asset writer in the format of `packages/scene/src/mesh-asset.ts`) and xUnit tests; verify "a burst of 30 changes is one batch" and a contract test where C# writes a fixture the TypeScript reader loads and the bounds match
- [x] 2.2 Add `# r:` requirement-line parsing and Python result shaping (output cap at 20 000 characters, `result`, error with the end of the traceback) to the core library; verify unit tests for "output is capped", "output and result come back" and "a package is listed for approval"
- [x] 2.3 Add the plugin project (`net48;net7.0`, RhinoCommon 8.x compile-time reference) with `HaiConnect` and `HaiDisconnect`; verify it builds for both targets
- [ ] 2.4 Add the C# job to CI on windows-latest (`dotnet test` for the core library, build for the plugin); verify it runs green

## 3. Plugin behaviour (manual in Rhino)

- [ ] 3.1 Implement connect, discovery, reconnect within 5 s and the command-line messages; verify "connect", "bridge not running" and "bridge restart" by the manual script
- [ ] 3.2 Mirror the document: subscribe to the document events, collect for 100 ms, mesh changed objects with RhinoCommon in slices of at most 10 ms, upload each mesh as an asset, then send the batch with descriptors and `changedAt`; send the first sync small objects first with a count; verify by the manual script "a new object appears in HAI", "a moved object follows", "a deleted object goes", "layer colour changes show" and "it works with Rhino minimised"
- [ ] 3.3 Select by id when the bridge asks (after `UnselectAll`, empty clears) and report what is not drawn (curves, points, annotations, objects over the triangle cap); verify "a pick selects in Rhino" and that the HUD counts match the document by the manual script
- [ ] 3.4 Send selection changes debounced at 50 ms; verify selection appears in the HUD within 200 ms

## 4. The Python workbench (works with Rhino closed)

- [x] 4.1 Find a Python 3.10+, check the environment's path length (under 200 characters, else use `%LOCALAPPDATA%\HAI\python\<project hash>`), (the `py` launcher, then `python`), create the managed environment in `.hai/python` and install the starting packages through an injectable installer; verify bridge tests for "first use", "no Python on the machine" and a failed install
- [x] 4.2 Add the `python_run` tool: a subprocess in the project folder, output cap, `result`, error and traceback, time limit, Stop ends the process within 3 s; verify "a script runs and answers", "works without Rhino", "an error is returned" and "stop" against a real environment (skipped where no Python is installed)
- [x] 4.3 Add approval for the workbench (card with the script and the packages, packages requested through an explicit argument, always allow per project that never covers a new package); verify "a new library", "denied" and "always allow does not cover a new package" with the fake agent
- [x] 4.4 Keep every run as a script in `.hai/scripts` with its header; verify "a run is kept" and that the folder is git-ignored
- [x] 4.5 Offer **Import into viewer** (the existing importer) and **Open in Rhino** when a run writes a `.3dm`; verify "import a written file", "files are written directly" (`rhino3dm` writes and reads a box) and "the scene is untouched" in an E2E with the fake agent
- [x] 4.6 Add the `hai_3dm` helper (in this repository, found through `PYTHONPATH`; the desktop package copies it) with `save(model, path)`: attach render meshes to Brep faces and extrusions, triangulate planar trimmed faces from their outer loop, and let the runner end the process cleanly after the write; verify with the real importer on a canopy, a revolved solid with disc caps (bounds show discs, not squares) and an extruded column that every object imports with triangles, no "no mesh" skip, and exit code 0
- [x] 4.7 Write the capabilities and limits into the `python_run` description (what `rhino3dm` builds, what it cannot do, to save through `hai_3dm`, to prefer Rhino for booleans, fillets, lofts and sweeps); verify a test that every operation the description promises is exercised by the 4.6 test and every one it denies is absent from `rhino3dm`

## 5. Python in the open Rhino document

- [ ] 5.1 Spike: in Rhino 8, find how the plugin runs Python 3 in process with output and error capture, cancellation and `# r:` requirement lines (the `Rhino.Runtime.Code` scripting API, or a temporary script through Rhino's Python command), and measure the overhead of a trivial script; record the choice and numbers in `docs/decisions.md`; verify the note names the API and the measured overhead, and that cancel works or does not
- [ ] 5.2 Implement the runner in the plugin: UI thread, one undo record per run, result and error answer, time limit; verify "a script changes the document", "a Python error is returned, not thrown", "one undo reverts a run" and "time limit" by the manual script, with the shaping covered by the unit tests of 2.2
- [ ] 5.3 Report Python status in the hello and on change; verify "Python ready" and "Python unavailable" in bridge tests with the fake Rhino client, and by the manual script
- [x] 5.4 Add `rhino_run_python` and `rhino_get_document` to HAI's MCP server (run asks for approval and shows the script and its `# r:` packages; read is pre-approved) and the per-role tool lists; verify "a run waits for the user", "a package is listed for approval", "read the document" "roles get their tools" / "Reviewer cannot run Python", and "a run is kept" for a Rhino run, with the fake Rhino client and fake agent
- [ ] 5.5 Show Python status in the HUD with what to do when unavailable, and the Python tool chip timing; verify the E2E with the fake Rhino client and that a trivial script's overhead stays under 500 ms in the bridge test

## 6. Web side

- [x] 6.1 Add the mirror layer to the viewer: draw the table's meshes from assets with layer colours and a selection highlight, map picks to Rhino ids, keep it out of the scene document, undo and project file, and show not-drawn counts and sync progress; verify "the Rhino model is drawn", "the mirror is not saved" and "a tap selects in Rhino" by E2E with the fake Rhino client
- [x] 6.2 Show the code (full and scrollable) and the packages on the approval card; verify "the card shows the script and the packages" by E2E and a Playwright screenshot in light and dark
- [x] 6.3 Add Settings > Modelling (Automatic, Rhino, Python only), keep it in `.hai/settings.json`, tell the bridge and show the mode in use in the HUD; verify "Automatic follows the connection", "Python only hides the Rhino tools from the agent and the mirror layer" and "the choice follows the workspace" with the fake Rhino client, and a Playwright check of the setting
- [x] 6.4 Show **Rhino to HAI** latency p90 (`drawnAt - changedAt`) in the HUD; verify "latency readout" by E2E and, with the fake Rhino client, a 50-object edit with p90 under 300 ms
- [x] 6.5 Handle `view.set` in the viewer (animate to the requested view over 400 ms, frame given elements); verify "agent sets the view" by E2E and that navigation by hand during the animation takes over

## 7. Docs

- [ ] 7.1 Write `docs/rhino.md` (install the plugin, `HaiConnect`, Python in Rhino, the Python workbench and its libraries, runs as scripts, approvals, that nothing is sandboxed, performance tips); verify the steps on a clean Rhino 8 profile and a machine with and without Python

## 8. Demo

- [ ] 8.1 Write `demos/13-rhino.md` (connect, ask the agent for a canopy and watch it appear in HAI's viewer with Rhino minimised, orbit it by hand, tap a surface and see it selected in Rhino, ask the agent to rotate it and to show it from the south-west, run a sun-hours study with Ladybug, then the same study from the saved `.3dm` with Rhino closed, record the Rhino to HAI latency p90) and record the clip; verify on the maintainer's Rhino 8
