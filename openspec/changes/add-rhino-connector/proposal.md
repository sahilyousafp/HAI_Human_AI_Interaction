# Proposal

## Why

Rhino is where precise design happens, and it is the user's daily tool. The same hands that orbit the built-in viewer should orbit, point at and select what is in Rhino, and let the agent act on it, with Rhino doing the modelling in the background and HAI's viewer showing the result. HAI is an interface for an agent and a human working together, and Rhino is its modelling and drafting host, not where its capabilities end. The agent's capabilities should come from Python: the whole ecosystem of analysis, geometry, climate, data and file libraries (Ladybug and NumPy to start, then whatever a task needs: Shapely, IfcOpenShell, Pandas and so on), working on `.3dm` files directly or driving Rhino when drafting is needed. A fixed set of tools exposed by an MCP server reaches only what its authors listed, and ties the agent to one application. What is missing is the fast, direct link between the user's body and Rhino's model, and a safe, general way for the agent to run Python, with or without Rhino.

## What Changes

- A small Rhino 8 plugin (`HAI for Rhino`) that connects to the local bridge with one command, `HaiConnect`, and reconnects automatically. No token copying is needed.
- **The Rhino model is mirrored into HAI's viewer.** The plugin meshes what changes in the open Rhino document (RhinoCommon's own meshing) and streams it to the bridge, and the built-in viewer draws it as a read-only layer, so the model stays in HAI, steered by the user's hands, while Rhino models in the background. Rhino's window can be minimised. Objects made by the agent's Python, by the user with the mouse, or by a Rhino command all appear. The mirror is not part of the HAI scene: it is not saved with the project and not in the undo history.
- **Picking works both ways.** A pinch tap on a mirrored object in HAI selects it in Rhino, and the agent's "this" is that Rhino object. Changes made in Rhino reach HAI within a budget of 300 ms (p90, edits of up to 50 objects), and the HUD shows the measured p90; a first sync of a large model arrives progressively, with a count.
- Rhino's selection is mirrored to the bridge and highlighted in HAI's viewer, so the agent and the HUD know what is selected in Rhino.
- **The agent can set the view.** A `set_view` tool lets the agent orbit, change elevation and distance, or frame elements in HAI's viewer (the agents reported having no way to move the camera). Rotating, moving, mirroring or arraying Rhino objects is done by `rhino_run_python`, which has all of RhinoCommon.
- **Settings > Modelling** (Automatic, Rhino, Python only), so the same workspace works on a machine with Rhino and one without. The agent is offered the tools of the mode in use and told what each can and cannot model.
- **A helper for the Python mode** (`hai_3dm`) that attaches render meshes to what `rhino3dm` writes, so a NURBS surface, a revolve or an extrusion made without Rhino draws in the viewer.
- **The agent works through Python, in two places**, as tools of HAI's own MCP server (nothing extra to install):
  - **The Python workbench (works with Rhino closed).** `python_run` runs Python in an environment HAI manages in the project: `rhino3dm` (read, build and edit `.3dm` files directly), `ladybug-core` (climate and sun) and `numpy` to start, and any other library the task needs, installed on the user's machine on demand after the user approves it (never shipped with HAI). This is the agent's general capability layer: analysis, geometry, data and file work that Rhino does not do. A `.3dm` it writes can be imported into the built-in viewer or opened in Rhino from the HUD.
  - **Live Rhino, for modelling and drafting.** `rhino_run_python` runs Python 3 inside the running Rhino 8 (RhinoCommon, `rhinoscriptsyntax`, `scriptcontext`), so the agent can model and draft in the user's open document. Packages come in through Rhino's `# r: package` requirement lines (for example `# r: ladybug-core`). Each run is one Rhino undo record and returns its output, its result and any error. `rhino_get_document` reads the document (units, layers, object counts, selection, active view) without running code.
- **Python is approved before it runs.** The approval card shows the whole script and every package it would install. Always allow is per project and never covers a package the user has not seen. HAI does not sandbox the code: like a shell command, it runs with the user's permissions, so the card is the control.
- Every run is kept in the project as a readable script with its packages, output and result (`.hai/scripts/`), so the human can read, rerun and edit what the agent did, and the agent can build on it.
- The HUD shows whether the managed Python environment is ready and whether Python is ready in Rhino, with how to fix what is not.
- The agent team gets the tools by role: Architect and Product both ways, Climate (Ladybug and other analysis libraries) the workbench and the read tool, Reviewer only the read tool.

Out of scope: driving Rhino's own viewport (camera sync, a cursor ring drawn in Rhino, hand navigation of Rhino's window; the mirror replaces them), drawing Rhino curves, points and annotations in HAI (they are counted and listed, not drawn), a mirror that follows Rhino's camera, an OpenCascade kernel for booleans and fillets without Rhino (measured in `docs/decisions.md`: 736 MB, blocked by Application Control here, and it cannot become native trimmed Breps), McNeel's RhinoAI MCP server and other Rhino MCP servers (a user who has one connected still gets it in their session, untouched; HAI does not require, wrap or detect it), `Rhino.Compute` and any hosted Rhino, sandboxing Python, reviewing agent changes in Rhino with ghosts and one-step reject (next change), palette tools that run Rhino commands (later, through the tool registry), Grasshopper definitions as a tool (later), Rhino 9 and macOS (later), packaging on Yak (later).

Demo clip (Week 13): "My AI models in Rhino and I steer it from HAI": ask the agent for a canopy over the slab and watch it appear in HAI's viewer while Rhino sits minimised, orbit it by hand, tap a surface and see it selected in Rhino, ask the agent to rotate it 30 degrees and to show it from the south-west, then run a sun-hours study on it with Ladybug. Then, with Rhino closed, ask for the same study from the saved `.3dm`.

## Capabilities

### New Capabilities

- `rhino-link`: connecting Rhino to the bridge, mirroring its model into HAI's viewer, picking and selection both ways, the modelling mode setting and Rhino Python status.
- `python-tools`: the agent's general Python capability layer, independent of Rhino: the managed environment, running Python with any approved library, runs kept as readable scripts, and bringing a written `.3dm` into the viewer or Rhino.
- `rhino-python`: the live-Rhino side: running Python in the open document for modelling and drafting, reading the document, packages through Rhino's own requirement lines.

### Modified Capabilities

- `local-access-control`: adds token-only connections for local non-browser clients such as the Rhino plugin (created by `add-claude-agent-bridge`).
- `scene-tools`: the user context includes the Rhino object under the pointer and Rhino's selection when Rhino is connected, and a `set_view` tool moves HAI's camera (created by `add-claude-agent-bridge`).
- `tool-approval`: approval cards for Python (in either place) show the script and the packages it would install, and always allow never covers a new package.
- `agent-team`: which agents get the Rhino Python tools and `set_view`.

## Impact

- New `plugins/rhino`: C# RhinoCommon plugin (`net48;net7.0`, RhinoCommon 8.x from NuGet), not linked against any McNeel source beyond the public SDK. It mirrors the document's meshes and selection to the bridge, selects by id on request, and runs Python in Rhino's Python 3 engine on the agent's behalf. It does not move Rhino's camera.
- `apps/bridge`: Rhino client role, discovery file in the user profile, the mirror table and its relay (mesh assets in the existing asset store), selection mirroring both ways, the `rhino`, `python` and `set_view` tools in HAI's MCP server, the managed Python environment (`.hai/python`) and its runner, and the kept scripts (`.hai/scripts`).
- `apps/web`: the mirror layer in the viewer (drawing, picking, selection highlight, latency readout), Settings > Modelling, Rhino and Python status, the `set_view` handler, the Import and Open buttons for a written `.3dm`, code and packages on approval cards.
- `packages/protocol`: Rhino messages (hello with client "rhino", object changes with descriptors, select, selection, Python run request and result, Python status), `view.set`, and the new tool names.
- Needs Python 3.10 or newer on the machine for the file mode (HAI finds it and says if it cannot). Live mode needs only Rhino 8 on Windows, whose own Python 3 installs the packages.
