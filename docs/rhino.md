# Rhino and Python modelling

The agent can model in two ways, and you choose which in Settings > Modelling ([settings.md](settings.md)):

- **Rhino** (the main way). Rhino 8 runs in the background and the agent works in its open document with all of RhinoCommon. HAI draws Rhino's model in its own viewer, so you keep looking at HAI and navigating with your hands.
- **The Python workbench** (the light way, no Rhino needed). The agent writes Python in an environment HAI manages in your project and saves a `.3dm` file you can bring into the viewer, or open in Rhino later.

Automatic, the default, uses Rhino while it is connected and the workbench otherwise, so the same workspace works on a machine with Rhino and on one without.

> **Status.** The workbench, the Rhino link in the bridge (connection, mirror relay, selection, tools) and the viewer's side (the mirror layer, Settings > Modelling, `set_view`) are built and tested against a stand-in for the plugin. The plugin itself (`plugins/rhino`) is written and builds for both of Rhino 8's runtimes, and its message, mesh and Python-handling code is tested without Rhino and against the bridge's own schemas; it has **not been run in a real Rhino 8 yet**, so the Rhino steps below are not verified. It cannot run Python in Rhino yet (that has to be worked out on a real Rhino first), so it tells the agent so and the agent uses the workbench.

## The Python workbench

Ask for something to be modelled, and the agent's `python_run` tool does it:

1. **You see the script first.** The approval card shows the whole script (it scrolls) and, when the script needs libraries that are not installed yet, which ones. Nothing runs, and nothing is installed, until you press Allow.
2. **The environment.** The first run creates a Python virtual environment in the project's `.hai/python` from a Python 3.10 or newer that is already on your machine (HAI does not ship Python), and installs `rhino3dm`, `ladybug-core` and `numpy` into it. Any other library the agent asks for is listed on the card and installed from PyPI on your machine only once you allow it. "Always allow" covers a tool for the project but never a new library: a script that wants one the project has not had before asks again. Where the project path is too long for Windows (over 200 characters) the environment lives in `%LOCALAPPDATA%\HAI\python` instead. No Python on the machine? The agent is told, and says so.
3. **Every run is kept.** The script is saved in `.hai/scripts` with a header (when, which agent, which packages), so you can open it and rerun it yourself. The folder is git-ignored.
4. **Output.** What the script printed, the value of a variable named `result`, and an error with the end of its traceback come back to the agent. Output is cut at 20 000 characters. A run ends after its time limit (60 s by default, 600 s at most) or when you press Stop (within 3 s).

### What `rhino3dm` can model

`rhino3dm` is McNeel's openNURBS library for Python. Without Rhino it can build NURBS curves and surfaces from control points and knots, Breps from surfaces, revolves, boxes, spheres and cylinders, planar trimmed shapes and extrusions, with layers, names and colours, and it writes `.3dm` files Rhino opens as they are.

It is not Rhino's kernel. It cannot loft, sweep, run booleans (union, difference, intersection), fillet, offset or intersect Breps, or mesh a Brep. The agent is told this, builds such shapes from control points where it can, and otherwise says so and, when Rhino is connected, uses Rhino instead. A test checks the list the agent reads against the installed library, so it cannot drift.

### Seeing what it wrote

HAI's viewer draws render meshes, which `rhino3dm` does not store. The agent saves through a helper that ships with HAI (`hai_3dm`): it attaches meshes (a planar face triangulated from its outline, an untrimmed surface meshed on a grid, an extrusion's sides and caps) and then writes the file.

```python
import rhino3dm as r, hai_3dm
model = r.File3dm()
hai_3dm.add(model, brep_or_extrusion, "Canopy", "Roof", (60, 110, 200))   # name, layer, colour
hai_3dm.save(model, "canopy.3dm")                                          # prints what it meshed
```

Lengths are millimetres, Z up. When a run leaves a new or changed `.3dm` in the project, a strip under the chat offers **Import into viewer**, and **Open in Rhino** while Rhino is connected. Nothing is imported or opened until you choose it, and `python_run` never changes the HAI scene by itself. Imported models are ordinary imported elements: saved with the project, in the undo history, and described by [import.md](import.md).

## Rhino

### Connecting

1. Build the plugin with `dotnet build plugins/rhino/src/HAI.Rhino/HAI.Rhino.csproj -c Release` (it needs the .NET SDK, not Rhino), install `bin/Release/net48/HAI.Rhino.rhp` (or the `net7.0` one, for Rhino running on .NET 7) with Rhino's `PlugInManager` > Install, and run `HaiConnect` in Rhino.
2. The plugin finds the running bridge through a small file in your user profile (`%LOCALAPPDATA%\HAI\bridge.json`, readable by you only), connects to it on this machine with the session token, and reports Rhino's version, the open document and whether Python runs inside Rhino. The bridge accepts a connection without a browser origin only from a client that says it is Rhino and presents the token.
3. The top bar shows **Rhino connected**. Run `HaiDisconnect` to stop; if the bridge is restarted the plugin reconnects within 5 seconds.

Nothing leaves your computer: the bridge listens on 127.0.0.1 only.

### What you see

While Rhino is connected and the mode is not Python only, every object in Rhino's open document is drawn in HAI's viewer, in Rhino's layer colours, whoever made it: the agent, a Rhino command or you with the mouse. Adding, changing, moving, recolouring and deleting show within a fraction of a second. Rhino's window can be minimised.

- **It is a mirror, not part of the HAI scene.** It is not saved with the HAI project, not in its undo history and not changed by the scene tools (`update_elements` and the others). Rhino owns the objects; its own undo undoes them.
- **Picking.** Tap an object in HAI (with a hand or the mouse) and Rhino selects it; what is selected in Rhino is highlighted in HAI. When you say "this" to the agent while pointing at a Rhino object, it is told which object that is.
- **What is not drawn.** Curves (the Python workbench and imports draw curves as thin tubes, but the plugin does not mirror them yet), points, annotations, block instances and other kinds of object are not drawn, and an object with more triangles than the cap is drawn as its bounding box. Settings > Modelling counts both.
- **A large document** arrives progressively, smaller objects first: the top bar shows **Syncing 120 of 4000**.
- **Speed.** The top bar shows **Rhino to HAI**, how long the last changes took to be drawn (the 90th percentile over the last 3 seconds). The target is under 300 ms for edits of up to 50 objects; measured with the stand-in for the plugin on the development laptop, a 50-object edit is drawn in about 100 ms. The time spent meshing inside Rhino is not part of the figure.

### What the agent does in Rhino

| Tool | What it does |
|---|---|
| `rhino_run_python` | Runs a Python 3 script inside your open Rhino with all of RhinoCommon, as one undo step. You see the script first, with the libraries a `# r: package` line would have Rhino install. Transforming objects (rotate, move, mirror, array), booleans, lofts, sweeps and fillets all go through it |
| `rhino_get_document` | Reads units, layers, object counts, selection and the active view. Pre-approved |
| `set_view` | Moves **HAI's** camera: turn, tilt, nearer or further, look at a point, or frame elements (including Rhino objects, by id). The camera animates there over 400 ms and gives way at once if you navigate yourself. It changes nothing in the model |

Rhino's own viewport is not driven: HAI's viewer is the one you look at. Where a script's result changes the model, the mirror shows it.

Scripts run on Rhino's one user-interface thread, one at a time, and nothing is sandboxed: a script has all of RhinoCommon and your user's rights, which is why you see it before it runs.

## Performance tips

- A very dense mesh is capped; model the heavy parts as a few objects or let them show as boxes.
- Break a long script into steps: each run is one undo step, and Stop ends the run at the next safe point.
- The first Python run in a project installs libraries; later runs start in well under a second.

## Where things live

| What | Where |
|---|---|
| The managed Python environment | `.hai/python` in the project (or `%LOCALAPPDATA%\HAI\python\<hash>` for long paths) |
| Kept scripts | `.hai/scripts` |
| The libraries you allowed | `.hai/approvals.json` |
| The meshes of Rhino's objects while it is connected | `.hai/mirror` (cleared on disconnect, never part of the project) |
| Rhino discovery file | `%LOCALAPPDATA%\HAI\bridge.json`, removed when the bridge stops |
| Protocol | `packages/protocol/src/rhino.ts` |
