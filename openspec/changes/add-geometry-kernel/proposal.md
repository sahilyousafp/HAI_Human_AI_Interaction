# Proposal

## Why

"Copy this element along the curve, one every 30 cm, the width starting at 15 cm and tapering" is a request the agent could not do. The scene has no loft, sweep, boolean or offset, and `python_run` (rhino3dm, the openNURBS library for Python) cannot loft, sweep, boolean, offset or mesh a Brep either: it reads and writes files, it has no geometry kernel. The agent was left to fake such shapes from flat pieces or to say no. Nothing about these operations is Rhino specific, so the kernel should not be either.

## What Changes

- **`geometry_array_along_curve`**: copies an element along a curve (a line element, or the points of a sketch) every `spacing` millimetres or `count` times, each copy centred on its place on the curve and turned to run along it. A `width` (a massing's or column's width across the curve) and a `scale` can change in a straight line from the first copy to the last, which is "the width starts at 15 cm and tapers". The copies are ordinary elements. It needs no kernel, so it works on every machine.
- **OpenCascade, the geometry kernel**, through Python (`cadquery-ocp`, pinned to the release the recipes are tested with), in the project's managed Python environment. Four tools use it:
  - `geometry_loft`: through two or more sections, smooth or ruled; closed sections make a solid.
  - `geometry_sweep`: a profile along a rail, optionally smoothed into one curve.
  - `geometry_boolean`: union, difference and intersection of massings, columns, walls and slabs, as the extrusions of their footprints.
  - `geometry_offset`: a flat curve sideways, with sharp or round corners, as new line elements.
  Each makes its result in the model at once, in one undo step. A loft, sweep or boolean is an imported model (a mesh stored as an asset) the user can move, turn, scale and delete.
- **Installed on first use, with consent.** The kernel is not shipped. The first of those four tools shows an approval card that lists what would be installed; once it is there they run without asking. If the operating system refuses to load OpenCascade's native library (Windows Smart App Control does on some machines), the tool says so and changes nothing.
- **`python_run`'s description corrected**: it no longer claims nothing can loft or sweep; it points at the tools, and at `cadquery-ocp` for other kernel work in a script.
- **The agent is told** to use these tools for array, loft, sweep, boolean and offset jobs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `scene-tools`: the geometry tools.
- `tool-approval`: a tool that needs a large installation asks before installing it, and not after.

## Impact

- `apps/bridge`: `python/hai_occ.py` (the recipes) and its tests, `src/geometry/kernel.ts` (runs a recipe through the Python workbench), `src/mcp/geometry-tools.ts`, the approval broker, the roster, the agent's prompt.
- `packages/scene`: `along-curve.ts` (where copies go on a curve, and what each copy looks like).
- `packages/protocol`: the `geometry` tool group.
- `docs/agent.md`: the tools and the kernel.
- Not changed: how imported models are drawn and snapped; lofts and booleans are meshes, so they have no editable shape.
