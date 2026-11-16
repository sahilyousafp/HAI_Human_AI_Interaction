# Hosts: Rhino, Blender and Revit

HAI does not model. The design applications you already use do, each with its own tools, and HAI is where you see all of their models and steer the work with your hands, your face and your voice. HAI calls them **hosts**. Each connects through a small connector of HAI's own, and they all speak one contract, so the agent and the viewer treat them the same way.

| Host | Best for | Connector | Status |
|---|---|---|---|
| **Rhino 8 and 9** | Form and NURBS: lofts, sweeps, booleans, fillets, SubD, fabrication geometry, Grasshopper | `plugins/rhino` (C#) | Built; checked in a real Rhino 8.36 and 9.0 for the mirror and runs |
| **Blender** | Visualisation and mesh work: materials, lighting, renders, modifiers, IFC through Bonsai | `plugins/blender` (Python) | Planned (`add-blender-connector`) |
| **Revit** | BIM: native walls, floors, roofs, doors and windows, levels, families, schedules and sheets | `plugins/revit` (C#) | Planned (`add-revit-connector`) |

Why HAI drives each host through its own connector instead of a vendor's MCP server: [decisions.md](decisions.md), "HAI orchestrates host applications", and [research/host-connectors.md](research/host-connectors.md).

Without any host, the agent can still make geometry with the Python workbench, which writes `.3dm` files you can import ([Python workbench](#the-python-workbench)).

## Settings > Hosts

One switch per host, all on by default. A host that is switched off is not drawn and the agent cannot use it, even while it is connected. For each host the page says whether it is connected and how to connect it if not, whether the agent can run code in it and, if not, why and what to do, how far the first sync has got, and what is not drawn. The choice is kept with the workspace (`.hai/settings.json`), so it follows you between a machine with an application and one without. A workspace that had chosen **Python only** in the old Settings > Modelling opens with Rhino switched off.

The top bar shows one compact pill per connected host: the host's icon with a status dot in its corner, and the number of milliseconds a change in the host takes to be drawn in HAI (the 90th percentile over the last 3 seconds). The icons are plain shapes for what each host does best, not the vendors' logos: a NURBS patch for Rhino, a lit sphere for Blender, a building section for Revit. Hover for the words ("Rhino connected"); screen readers say them. While a document arrives the pill shows how far it has got (**120/4000**, with a pulsing dot), and when the host cannot run code its dot turns amber and the tooltip says why. While the bridge itself is offline no host pill is shown, since HAI cannot know what the hosts are doing. The camera, microphone and bridge pills work the same way, and keep their words visible whenever something needs you (the bridge offline, the speech model loading, listening for names).

## What you see

While a host is connected and switched on, every object in its open document is drawn in HAI's viewer, in the host's colours, whoever made it: the agent, a command in the host, or you with the mouse. Adding, changing, moving, recolouring and deleting show within a fraction of a second. The host's window can be minimised. Two hosts are drawn at the same time, each as its own layer.

- **It is a mirror, not part of the HAI scene.** It is not saved with the HAI project, not in its undo history, and not changed by the scene tools. The host owns its objects, and its own undo undoes them.
- **Picking.** Tap an object (with a hand or the mouse) and its host selects it; the other hosts' selections clear, so "this" is always one host's. What is selected in a host is highlighted in HAI.
- **What a selection is.** When the selection in a host settles, HAI asks the host to describe it: what each object is in the host's own words, its layer, its box, its area, volume or length, its material and its own properties (Rhino's user strings, Blender's custom properties, Revit's parameters). A request you make while something is selected carries that description, so the agent knows exactly what "this" is.
- **Blocks.** Each kind of block is meshed and uploaded once, and every placement shares that mesh, with its own position and the colours of what the block holds.
- **A model too heavy to draw.** Over 5 million triangles, the heaviest blocks placed more than once are drawn with less detail ([import.md](import.md#a-model-over-the-limit)); a block of more than 1 million triangles is drawn as its box. The host's model is never changed.
- **What is not drawn.** Curves, points, annotations and other kinds of object are not drawn, and an object over the triangle cap is drawn as its box. Settings > Hosts counts both.
- **A large document** arrives progressively, smaller objects first.
- **Speed.** The target is under 300 ms from a change in the host to the drawn frame, for edits of up to 50 objects; measured with a stand-in for the connector, a 50-object edit is drawn in about 100 ms. A real Rhino model of 3180 objects and 3.4 million triangles arrived in about 15 seconds.

## What the agent does in a host

| Tool | What it does | Who has it |
|---|---|---|
| `host_list` | Which hosts are connected and on, what each does best, whether code can run in it now | Every agent |
| `host_run` | Runs a script in a host, in its own language (Python with RhinoCommon in Rhino, `bpy` in Blender, C# in Revit), as one undo step there. You see the script, the host and any packages first | Architect, Product |
| `host_read` | The document's units, layers or collections, object counts, selection and active view | Every agent |
| `host_capture` | A picture of the host's own viewport, its active view or a named one, so the agent can check its work against what the host draws | Every agent |
| `host_place_image` | Puts an image from the project into the host as a picture on a plane (a site photo, a reference), embedded, as one undo step | Architect, Product |
| `host_api` | Looks up the host's scripting API inside the running host, so the answer matches your version | Every agent |
| `host_describe` | Describes objects by id, as the selection is described | Every agent |

The host tools exist only while at least one host is connected and on, and their descriptions name only the hosts in use: the agent's tools follow what you have.

- **Nothing is sandboxed.** A script has all of the host's API and your user's rights, which is why you see it before it runs. **Always allow** is kept per host and per project: allowing runs in Rhino does not allow them in Revit, and it never covers a package you have not seen. A project that always allowed the old `rhino_run_python` keeps that choice for Rhino.
- **One at a time per host.** A host runs one script at a time, in the order asked, and a script's time limit starts when the host gets it. Two hosts run their scripts side by side.
- **Claims.** Each run carries the agent's name, the run's title and its task's claim; the connector stamps what the run adds with `hai.owner` and `hai.part`. After the run the bridge compares what changed with the claim and tells the agent and you what it touched outside it, with **Undo in Rhino** (or the host's name). This is checked afterwards; it cannot prevent anything ([parallel.md](parallel.md#scripts)).
- **Every run is kept** in `.hai/scripts` as a readable script (`.py`, or `.cs` for Revit) with a header saying which host, which agent, which packages and the outcome.

## Rhino

### Connecting

1. Build the plugin with `dotnet build plugins/rhino/src/HAI.Rhino/HAI.Rhino.csproj -c Release` (it needs the .NET SDK, not Rhino) and install `bin/Release/net8.0/HAI.Rhino.rhp` (or the `net48` one for a Rhino 8 started on .NET Framework) with Rhino's `PlugInManager` > Install.
2. Run `HaiConnect` in Rhino. The plugin finds the running bridge through `%LOCALAPPDATA%\HAI\bridge.json` (readable by you only) and connects with the session token. Run `HaiDisconnect` to stop; if the bridge restarts, the plugin reconnects within 5 seconds.
3. **After updating HAI, install the new plugin too.** The bridge refuses a plugin built for an older protocol, and Rhino's command line says: *This HAI for Rhino is older than the bridge: install the new one.* The plugin then stops trying until you run `HaiConnect` again.

Nothing leaves your computer: the bridge listens on 127.0.0.1 only.

### Running Python in Rhino

Scripts run through Rhino's ScriptEditor on its one user-interface thread, with all of RhinoCommon, `rhinoscriptsyntax` and `scriptcontext`. A `# r: package` line at the top has Rhino install a package from PyPI, and the approval card lists it. A trivial script takes about 50 ms. While you are in the middle of a Rhino command a script is not started, and the agent is told to try again. The time limit stops Python code but cannot interrupt a call into Rhino until it returns. What a script added before it failed or was stopped stays, and one undo removes it.

### Capture, pictures, API and descriptions

- **Capture** renders Rhino's viewport with `ViewCapture`, at most 1280 pixels on the long side. A named view (top, front, perspective and the rest) is shown only for the capture, framed on the model, and the viewport goes back to where you had it.
- **Picture frames** are added with `AddPictureFrame`, embedded in the document, centred on the point asked for, standing upright when they face sideways, as one undo step named after the agent and the title.
- **API lookup** searches RhinoCommon's public types and members by reflection, with the summaries of `RhinoCommon.xml` when Rhino ships it. The index is built in the background after connecting; a lookup before it is ready answers with what is indexed so far and says so.
- **Descriptions** give an object's area and volume only where that is quick (a Brep of up to 200 faces, a mesh of up to 200 000), and stop measuring once a description has taken a quarter of a second; the rest are marked as not worked out.

**Not yet checked in a real Rhino:** capture, picture frames, API lookup and descriptions are built and compile against RhinoCommon, and their messages are checked against the bridge, but the manual script has not been run on them yet.

## The Python workbench

With no host, the agent writes Python in an environment HAI manages in your project (`python_run`) and saves a `.3dm` you can bring into the viewer. It needs Python 3.10 or newer on your machine and installs `rhino3dm`, `ladybug-core` and `numpy` on first use, after you allow it. `rhino3dm` builds NURBS curves and surfaces, revolves, extrusions and planar shapes, but cannot loft, sweep, run booleans, fillet or offset; the agent is told so. The agent saves through `hai_3dm`, which attaches the meshes HAI's viewer draws. Nothing is imported until you choose **Import into viewer**, and **Open in Rhino** is offered while Rhino is connected.

## Where things live

| What | Where |
|---|---|
| The meshes of each host's objects while it is connected | `.hai/mirror/<host>` (cleared on disconnect, never part of the project) |
| A host's captures, read once by the bridge | `.hai/mirror/captures`, dropped after 10 minutes |
| Kept scripts | `.hai/scripts` |
| Always allowed tools and the packages you allowed | `.hai/approvals.json` |
| The managed Python environment | `.hai/python` (or `%LOCALAPPDATA%\HAI\python\<hash>` for long paths) |
| The discovery file connectors read | `%LOCALAPPDATA%\HAI\bridge.json`, removed when the bridge stops |
| The contract | `packages/protocol/src/host.ts` and the `host.*` messages in `messages.ts` |
