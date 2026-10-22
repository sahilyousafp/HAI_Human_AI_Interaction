# Design

## Context

Facts checked on 2026-10-19, and revised on 2026-10-22:
- RhinoCommon 8.35 on NuGet targets `net48` and `net7.0`; the .NET 9 SDK is installed on the maintainer's machine.
- Rhino 8 scripts in Python 3 with all of RhinoCommon and `rhinoscriptsyntax`, and installs packages from PyPI for a script that names them in `# r: package` comment lines. The agent session already loads the user's own MCP servers (`add-claude-agent-bridge`); a Rhino MCP server the user connected is simply one of them and is not part of this design.
- **Not yet checked, and the first Python task is a spike for it:** which API lets a plugin run Python 3 in process, capture its output and errors, cancel it and honour `# r:` lines (candidates: Rhino 8's `Rhino.Runtime.Code` scripting API, or writing a temporary script and running it through Rhino's Python command). Nothing below depends on which one wins, only on the plugin being able to do those four things.
- `rhino3dm` (openNURBS for Python) reads and writes `.3dm` files without Rhino. `ladybug-core` is pure Python and runs in both environments; `ladybug-rhino` needs Rhino.

## Goals / Non-Goals

**Goals:**
- Hand navigation in Rhino feels as direct as in the built-in viewer: Rhino redraw latency p90 under 80 ms on the reference laptop.
- The agent's capabilities are Python's: any approved library (Ladybug, NumPy, Shapely, IfcOpenShell, Pandas, ...), on `.3dm` files directly or in the live Rhino, with the user shown the code and the packages first. Rhino is the modelling and drafting host, and nothing in the workbench needs it.
- What the agent runs stays readable and reusable by the human.
- The plugin stays small: camera, pointer, picking, selection, and a Python runner.

**Non-Goals:**
- Sandboxing Python. Scripts can do anything the user can; the approval card is the control, as it is for a shell command.
- Wrapping, detecting or depending on any Rhino MCP server.
- A transparent overlay window over Rhino (later change); feedback is drawn inside Rhino with a display conduit.

## Decisions

**Plugin connects out to the bridge** as a WebSocket client (`System.Net.WebSockets.ClientWebSocket`, present in both `net48` and `net7.0`), rather than Rhino hosting a server. The bridge stays the single hub with one security model, and Rhino needs no open port. Rejected: Rhino-hosted server (a second listener to secure); a TCP socket server in Rhino as community Rhino MCP servers use (a different purpose, unauthenticated).

**Discovery without copy-paste.** The bridge also writes `{port, token}` to `%LOCALAPPDATA%\HAI\bridge.json` with a user-only ACL and deletes it on shutdown. `HaiConnect` reads it. Connections without an Origin are accepted only with the token and `hello.client = "rhino"`. Browsers always send an Origin, so web pages cannot use this path.

**Threading.** WebSocket receive runs on a background task. Every document or view change is marshalled with `RhinoApp.InvokeOnUiThread`. Camera deltas are coalesced: the latest accumulated delta is applied at most once per Rhino idle tick, so a burst of 30 updates never queues 30 redraws. A Python run changes the document, so it runs on the UI thread too and blocks Rhino's interface while it runs; that is why every run has a time limit.

**Camera math.** Turntable around world Z, the same as the web controller. Azimuth and elevation deltas rotate the camera location about the target (elevation clamped to 5-89 degrees). Zoom scales the camera-target distance by `exp(delta)`. Pan moves camera and target together in the view plane, scaled by distance. Applied with `RhinoViewport.SetCameraLocations(target, location)`, then `view.Redraw()`. Parallel viewports: pan and zoom only.

**Latency measurement.** Each camera message carries the frame's `captureTs` in epoch milliseconds. After the redraw that applied it, the plugin sends `rhino.redrawn { captureTs, redrawTs }` from `DateTime.UtcNow`. Both clocks are wall-clock on the same machine. The web computes p90 over 3 s.

**Pointer and picking.** The pinch point arrives normalised. The plugin maps it to the active viewport's client rectangle and draws a ring in `DisplayConduit.DrawForeground`. Picking uses `PickContext` with a pick line through the cursor at up to 15 Hz, with a highlight on the hovered object through the conduit (not the document selection). A tap selects via `doc.Objects.Select` after `UnselectAll`.

**Selection sync.** Subscribe to `RhinoDoc.SelectObjects`, `DeselectObjects` and `DeselectAllObjects`; debounce 50 ms; send ids with object type and layer full path.

**Host routing.** `activeHost: "web" | "rhino"` lives in the bridge (shared state) and the web input router sends navigation and pointer messages to the active host only. When Rhino disconnects, the host falls back to the built-in viewer.

**Python, not a list of tools.** The agent gets one general tool for the workbench (`python_run`, independent of Rhino) and one for the open Rhino document (`rhino_run_python`), plus a cheap read tool (`rhino_get_document`) so it can look before it writes. The workbench is the agent's capability layer and Rhino is a host it can draft in: that is why the workbench is its own capability (`python-tools`) and works with Rhino closed. An LLM writes good Python for Rhino, and Python is open-ended: it reaches every RhinoCommon call, loops and conditions in one round trip, and any library (Ladybug for sun and climate, NumPy for the maths) with no tool to add per capability. Rejected: a curated tool per operation as in a Rhino MCP server (every missing operation is a missing capability, and each tool is another thing to maintain); depending on a third-party Rhino MCP server (its tool list is the ceiling, and it must be installed, detected and kept in step with Rhino).

**Live run protocol.** The bridge sends `rhino.python.run { id, code, timeoutMs }`; the plugin runs it on the UI thread inside one undo record labelled `HAI: <agent>: <title>`, and answers `rhino.python.result { id, ok, stdout, result, error, durationMs }`. `result` is the value of a variable named `result` if the script set one. Output is capped at 20 000 characters and an error carries the message and the last lines of the traceback, so the agent can fix its script. The default time limit is 60 s. Stop cancels the run; if the Rhino scripting engine cannot interrupt it, the plugin abandons the result at the time limit and the HUD says Rhino is still busy (the spike measures which). The tool chip shows the round-trip time; the budget for the overhead of a trivial script is 500 ms, measured by the bridge from request to result.

**Packages are part of the approval.** The bridge reads the `# r:` lines out of the script before it runs and puts the package names on the approval card beside the code, because installing from PyPI runs someone else's code. Always allow remembers the tool for the project and the packages the user has already approved; a run that adds a package asks again. Rejected: allowing any package once the tool is allowed (the one approval a user gives for "run Python" should not silently stretch to new third-party code).

**A managed Python environment, the workbench.** `python_run` runs in a virtual environment HAI creates in `.hai/python` (git-ignored) from a Python 3.10+ it finds on the machine (the `py` launcher, then `python`). The first use shows an approval card listing what it will install (`rhino3dm`, `ladybug-core`, `numpy`); a run asks for any further library through an explicit `packages` argument that the card also lists, so the agent is never limited to a list HAI chose. Libraries are installed on the user's machine from PyPI at the user's approval and are never bundled or shipped, so their licences are the user's to accept, not part of HAI's (the project rule against GPL and AGPL in shipped code stands). The working directory is the project folder; output and the time limit work as in live mode; Stop ends the process. Rejected: the user's global Python (HAI would change it); a bundled Python (size, licensing and updates for a feature most runs of the live mode do not need); `Rhino.Compute` (a licence and a hosted service for what `rhino3dm` does locally).

**Runs are kept as scripts.** Every run, in either place, is written to `.hai/scripts/<timestamp>-<title>.py` with its packages, output, result and outcome in a header comment, so the human can open, edit and rerun it (a rerun is a request through the same approval) and the agent can find and extend earlier work. The folder is git-ignored with the rest of `.hai`. Rejected: keeping runs only in the chat history (not reusable by the human and lost with the session).

**Files come back through the importer.** When a `python_run` leaves a new or changed `.3dm` in the project folder, the bridge tells the web app, and the HUD offers **Import into viewer** (the existing 3dm import, `add-precision-aids-and-3dm-import`) and, when Rhino is connected, **Open in Rhino**. Nothing is imported or opened without that click.

**Tools by role.** `rhino_run_python` changes the model, so it goes to the agents marked as changing it (Architect, Product). `python_run` can only write files, so Climate gets it too (Ladybug and other analysis libraries). `rhino_get_document` is read-only and goes to everyone, Reviewer included. The bridge offers an agent only the tools its definition lists (`add-mochi-agent-team`).

**Status.** The plugin reports `python: ready | unavailable` in its hello and after any change, with a reason. The bridge reports the managed environment as `missing | ready | unavailable` with a reason (no Python found, install failed). The HUD shows both and says how to fix each.

**Build and test.** `plugins/rhino/HAI.Rhino.csproj` (SDK-style, `net48;net7.0`, RhinoCommon `8.*` as a compile-time-only reference). Camera math, message parsing, `# r:` line parsing and result shaping sit in a plain `HAI.Rhino.Core` library with xUnit tests that run in CI without Rhino. Rhino-dependent behaviour is checked by a manual script in `demos/`. The bridge side is tested against a fake Rhino client that answers Python runs, and the file mode against a real managed environment (skipped where no Python is installed).

## Risks / Trade-offs

- [Rhino redraw time on heavy models exceeds the latency budget] → Coalescing keeps latency bounded; the HUD shows the measured p90; document "use a lighter display mode while navigating by hand".
- [The plugin cannot be tested in CI without Rhino] → Pure core library with unit tests; integration covered by a fake Rhino client in bridge tests plus the manual demo script.
- [A long script freezes Rhino's interface] → A 60 s default limit, Stop, and the HUD says Rhino is busy; the agent's instructions tell it to keep runs short and to split big jobs.
- [Python can do anything, including harm] → Nothing runs without the user seeing the code and the packages; no sandbox is claimed, and `docs/rhino.md` says so plainly.
- [A package that Rhino or the managed environment cannot install] → The error comes back to the agent and the HUD; the script can fall back to what is installed.
- [Python gets cancelled but Rhino cannot interrupt it] → The spike measures it; the result is abandoned at the limit and the HUD says Rhino is still busy.
