# Proposal

## Why

Three gaps showed up the first time real Rhino models were used with the Week 11 work:

- **Snapping only works at ground level.** The drawing aids match the pointer's point on the ground plane (height 0) against the plan positions of other elements. An endpoint of a wall on an upper level, or a corner of an imported building roof, is not under the ground point of where it appears on screen, so it never snaps. All new elements are also created on the ground level, wherever the user snapped.
- **Measure does not snap.** It takes the exact surface point under the pointer, so distances between corners and edges are only as exact as the hand.
- **A project cannot leave the app or start empty.** Opening a folder with no project seeds the sample building, there is no clean space to import into or draw in, and nothing saves a project as a Rhino file.

## What Changes

- **Snapping at every height.** Snap candidates are 3D points (the corners, ends, midpoints and centres of walls, slabs, columns, massings and imported models, at their real heights). The pointer is matched against them on screen, within 24 px, whatever level they are on. The new point is placed at the snapped point's height, and a tool that creates elements puts them on the level whose elevation matches it (or on no level, at that height, when none does).
- **Measure snaps.** Measure uses the same aids: its two points snap to endpoints, midpoints and centres in 3D, and to the nearest edge with Project. Without a snap it keeps taking the surface point. The notice adds the horizontal and vertical parts of the distance.
- **New project.** A "New project" button creates a project folder with an empty scene (one ground level, nothing else) and opens it, ready to import into or draw in. It never overwrites a folder that already has a project.
- **Save as 3dm.** A "Save as 3dm" button writes the open project as a Rhino file the user downloads: walls, slabs, columns and massings as native Rhino extrusions, imported models as meshes, on layers named after their element type or their source layer, with the element's name and properties, in millimetres.

Out of scope: reading Rhino curves, snapping to the surface of imported meshes (their bounding box corners and centre only), round-trip editing in Rhino, saving as 3dm from the agent, and other file formats (IFC, OBJ).

Demo clip (Week 12, 30-60 s, `demos/12-3d-snapping-and-project-files.md`): "From a blank project to a Rhino file": start a new project, import a model, snap a wall to a rooftop corner three levels up, measure between two corners, save as 3dm and open it in Rhino.

## Capabilities

### New Capabilities

- `project-files`: starting an empty project and saving the project as a Rhino `.3dm` file.

### Modified Capabilities

- `drawing-aids`: snapping at every height, the level a new element is placed on, and snapping in the Measure tool. This capability is created by `add-precision-aids-and-3dm-import`, which must be archived first; the requirements here are added to it and refine its plan-only "Points snap to existing geometry".

## Impact

- `packages/scene`: `snap.ts` works on 3D candidates and screen distances (a projection function is passed in); a pure `export3dm` geometry builder (extrusion footprints and base heights per element).
- `apps/web`: `ToolContext` gains the camera projection for snapping; create tools place points at the snapped height and level; Measure uses the resolver; `New project` and `Save as 3dm` buttons in the project bar; an export worker beside `import/`.
- `apps/bridge`: `project.create` message that seeds an empty scene (no sample); `scene.apply` unchanged.
- `packages/protocol`: `project.create` message.
- Uses `rhino3dm` (already shipped) to write files.
- Docs: `docs/tools.md`, `docs/import.md` (becomes import and export), roadmap and README (Week 12; the Rhino connector and later weeks move down by one).
