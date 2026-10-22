# Importing and saving Rhino models

Import brings a Rhino `.3dm` file into the open project as reference geometry: the Import button in the project bar, or drop the file on the viewer. The file is read in your browser; only the converted geometry goes to the local bridge.

## What rhino3dm can read (spike, rhino3dm 8.35.0)

Checked on `.3dm` files written with rhino3dm itself; files saved by Rhino are checked on the maintainer's machine for the Week 11 clip (`demos/11-precision-and-import.md`).

| Thing in the file | What the reader gives | What import does |
|---|---|---|
| Mesh | vertices and faces (`toThreejsBuffers(false)` triangulates and returns typed arrays) | imported |
| Brep | one render mesh per face if the file has them (`face.getMesh(MeshType.Any)`), else `null` | imported from face meshes; none means "no mesh" in the report |
| Extrusion | `getMesh` is `null` without a stored mesh; `toBrep(true)` faces carry none either | imported if a mesh is stored, else "no mesh" |
| Block instance | `InstanceReference` with `parentIdefId` and a row-major 4x4 `xform`; the definition's objects are flagged `isInstanceDefinitionObject` and listed by `getObjectIds()` | definition objects are skipped at top level and expanded through each reference's transform |
| Curves, points, text, hatches, SubD | geometry objects | skipped and counted by reason |
| Units | `settings().modelUnitSystem` | scaled to millimetres |
| Layer and colour | `attributes().layerIndex`, `objectColor` with `colorSource`, layer `color` | kept on the element |

Enum values from rhino3dm compare by identity (`geo.objectType === rhino.ObjectType.Mesh`); use `.value` to put them in a map.

A Brep saved by Rhino with **Save small** has no render meshes, so its objects cannot be imported. Save the file again without Save small.

## Using it

- **Import** in the project bar opens a file picker (or press Ctrl+I). Browsers open a file picker only after a real mouse click or key press, so a pinch on the button explains that instead of opening it when you have not just used the mouse or keyboard; click it, press Ctrl+I, or drop the file.
- **Drop** a `.3dm` file anywhere on the page. A message shows while the file is over it, and the browser never opens or downloads the file.
- The model appears, the view frames it, and a report says how many objects came in and what was left out: `Imported 5 objects, read as millimeters. Skipped 5: 4 curves, 1 annotation.` The whole import is one undo step.
- Nothing is imported, and the scene is not changed, when the file cannot be read, has nothing importable, is over **500 MB**, or has more than **5 million triangles**; the report says which.

## What you get

Imported models are **reference geometry**: you can select, measure, section, move, copy and delete them, snap to their bounding boxes (Endpoint, Midpoint, Centre), and the agent sees each one as an element with a name, layer, colour and bounding box (never the triangles). Their shape cannot be edited.

- One element per object, named after the object (or the block, or the layer), with its layer name and display colour (Rhino's default black means no colour was chosen).
- A model with **more than 1000 objects** becomes one element per layer and colour, named after the layer and the number of objects it holds (`Facade (4210 objects)`), so the scene file stays small and quick to draw. A stand with 48 692 objects and 2.9 million triangles became 14 elements.
- Curves, points, text and hatches are not imported. A file that has only those (a plan drawn in curves, say) reports `The file has nothing that can be imported` and lists how many of each it skipped.
- Imported models are drawn with flat shading (each face lit by its own direction) and no edge lines (finding them costs time in proportion to the triangles).

## Where it is kept

The converted geometry is stored in the project folder as `assets/<id>.haimesh` (millimetres, Float32 positions and Uint32 indices behind a small JSON header), and the scene file only refers to it. The bridge serves it at `/assets/<id>` to the page that holds the session token and to nobody else. Assets that no element refers to are removed when the project opens. If a file is missing, its elements show as boxes and the project status names the file.

The WebAssembly file is 2.7 MB and is loaded only by the import worker, on the first import.

## Starting a new project

**New project** in the project bar asks for a folder, like Open project, and creates a project there with a clean space: one ground level and no elements, not the sample building. It opens at once for everyone, with nothing selected and nothing to undo, and the view frames the empty ground. A folder that already holds a project is never touched: the bar says so and nothing changes.

## Saving as a Rhino file

**Save as 3dm** builds a `.3dm` file from the open project in your browser and offers it as a download named after the project. Nothing leaves the machine and the project is not changed.

| In the project | In the file |
|---|---|
| Wall, slab, column, massing | A native Rhino extrusion of its footprint at its real base height (a wall is the rectangle around its baseline; a slab hangs down from its level), on the layer Walls, Slabs, Columns or Massings; its prism is stored as the render mesh too, so mesh-only readers (this app's import) can draw it |
| Imported model | A mesh moved by its translation, on its source layer (else Imported), in its colour |
| Name, id, level, properties | The object name, and user strings `hai.id`, `hai.level` and `hai.property.<name>` |

The file is in millimetres, Z up. Levels are not exported as objects (the level's name is kept on each element). An imported model whose file is missing from the project is left out and named in the report. An empty project says there is nothing to save. A saved file imports again here, and the report counts every object.
