# Proposal

## Why

Rhino is where precise design happens, and it is the user's daily tool. The same hands that orbit the built-in viewer should orbit Rhino's viewport, point at Rhino objects, and let the agent act on them. HAI is an interface for an agent and a human working together, and Rhino is its modelling and drafting host, not where its capabilities end. The agent's capabilities should come from Python: the whole ecosystem of analysis, geometry, climate, data and file libraries (Ladybug and NumPy to start, then whatever a task needs: Shapely, IfcOpenShell, Pandas and so on), working on `.3dm` files directly or driving Rhino when drafting is needed. A fixed set of tools exposed by an MCP server reaches only what its authors listed, and ties the agent to one application. What is missing is the fast, direct link between the user's body and Rhino's viewport, and a safe, general way for the agent to run Python, with or without Rhino.

## What Changes

- A small Rhino 8 plugin (`HAI for Rhino`) that connects to the local bridge with one command, `HaiConnect`, and reconnects automatically. No token copying is needed.
- Gesture navigation drives Rhino's active viewport (orbit, zoom, pan) when Rhino is the active host, with gesture-to-redraw latency measured and shown.
- The hand pointer appears in Rhino's viewport as a cursor ring. The object under it is highlighted, and a pinch tap selects it in Rhino.
- Rhino's selection is mirrored to the bridge, so the agent and the HUD know what is selected in Rhino.
- A host switch in the HUD: built-in viewer or Rhino.
- **The agent works through Python, in two places**, as tools of HAI's own MCP server (nothing extra to install):
  - **The Python workbench (works with Rhino closed).** `python_run` runs Python in an environment HAI manages in the project: `rhino3dm` (read, build and edit `.3dm` files directly), `ladybug-core` (climate and sun) and `numpy` to start, and any other library the task needs, installed on the user's machine on demand after the user approves it (never shipped with HAI). This is the agent's general capability layer: analysis, geometry, data and file work that Rhino does not do. A `.3dm` it writes can be imported into the built-in viewer or opened in Rhino from the HUD.
  - **Live Rhino, for modelling and drafting.** `rhino_run_python` runs Python 3 inside the running Rhino 8 (RhinoCommon, `rhinoscriptsyntax`, `scriptcontext`), so the agent can model and draft in the user's open document. Packages come in through Rhino's `# r: package` requirement lines (for example `# r: ladybug-core`). Each run is one Rhino undo record and returns its output, its result and any error. `rhino_get_document` reads the document (units, layers, object counts, selection, active view) without running code.
- **Python is approved before it runs.** The approval card shows the whole script and every package it would install. Always allow is per project and never covers a package the user has not seen. HAI does not sandbox the code: like a shell command, it runs with the user's permissions, so the card is the control.
- Every run is kept in the project as a readable script with its packages, output and result (`.hai/scripts/`), so the human can read, rerun and edit what the agent did, and the agent can build on it.
- The HUD shows whether the managed Python environment is ready and whether Python is ready in Rhino, with how to fix what is not.
- The agent team gets the tools by role: Architect and Product both ways, Climate (Ladybug and other analysis libraries) the workbench and the read tool, Reviewer only the read tool.

Out of scope: McNeel's RhinoAI MCP server and other Rhino MCP servers (a user who has one connected still gets it in their session, untouched; HAI does not require, wrap or detect it), `Rhino.Compute` and any hosted Rhino, sandboxing Python, reviewing agent changes in Rhino with ghosts and one-step reject (next change), palette tools that run Rhino commands (later, through the tool registry), Grasshopper definitions as a tool (later), Rhino 9 and macOS (later), packaging on Yak (later).

Demo clip (Week 13): "The same gestures now drive Rhino 8, and the agent writes Python": orbit and zoom a Rhino model by hand, point at a massing, tap to select it, then ask the agent to "run a sun-hours study on this with Ladybug and colour the faces by hours", and watch it run. Then, with Rhino closed, ask for the same study from the saved `.3dm`.

## Capabilities

### New Capabilities

- `rhino-link`: connecting Rhino to the bridge, viewport navigation, pointer and picking, selection sync, host switching and Rhino Python status.
- `python-tools`: the agent's general Python capability layer, independent of Rhino: the managed environment, running Python with any approved library, runs kept as readable scripts, and bringing a written `.3dm` into the viewer or Rhino.
- `rhino-python`: the live-Rhino side: running Python in the open document for modelling and drafting, reading the document, packages through Rhino's own requirement lines.

### Modified Capabilities

- `local-access-control`: adds token-only connections for local non-browser clients such as the Rhino plugin (created by `add-claude-agent-bridge`).
- `scene-tools`: the user context includes Rhino's pointed object and selection when Rhino is the active host (created by `add-claude-agent-bridge`).
- `tool-approval`: approval cards for Python (in either place) show the script and the packages it would install, and always allow never covers a new package.
- `agent-team`: which agents get the Rhino Python tools.

## Impact

- New `plugins/rhino`: C# RhinoCommon plugin (`net48;net7.0`, RhinoCommon 8.x from NuGet), not linked against any McNeel source beyond the public SDK. It also runs Python in Rhino's Python 3 engine on the agent's behalf.
- `apps/bridge`: Rhino client role, discovery file in the user profile, camera and pointer relay, selection mirroring, the `rhino` and `python` tools in HAI's MCP server, the managed Python environment (`.hai/python`) and its runner, and the kept scripts (`.hai/scripts`).
- `apps/web`: host switch, Rhino and Python status, routing of navigation and pointer to Rhino, the Import and Open buttons for a written `.3dm`, code and packages on approval cards.
- `packages/protocol`: Rhino messages (hello with client "rhino", camera delta, pointer, pick result, selection, redraw ack, Python run request and result, Python status) and the new tool names.
- Needs Python 3.10 or newer on the machine for the file mode (HAI finds it and says if it cannot). Live mode needs only Rhino 8 on Windows, whose own Python 3 installs the packages.
