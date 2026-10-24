/**
 * What the Python workbench can and cannot model without Rhino, as `rhino3dm` (openNURBS for Python) exposes it. Both
 * lists are checked against the installed `rhino3dm` by a test, so the description the agent reads cannot drift from
 * what is there: an operation promised must exist, and one denied must not.
 */
export const WORKBENCH_CAN = [
  "NurbsCurve.Create",
  "NurbsCurve.CreateFromLine",
  "NurbsSurface.Create",
  "NurbsSurface.CreateRuledSurface",
  "Brep.CreateFromSurface",
  "Brep.CreateFromRevSurface",
  "Brep.CreateFromBox",
  "Brep.CreateFromSphere",
  "Brep.CreateFromCylinder",
  "Brep.CreateTrimmedPlane",
  "Brep.CreateFromMesh",
  "Extrusion.Create",
  "Extrusion.CreateCylinderExtrusion",
  "RevSurface.Create",
] as const;

export const WORKBENCH_CANNOT = [
  "Brep.CreateFromLoft",
  "Brep.CreateFromSweep",
  "Brep.CreateBooleanUnion",
  "Brep.CreateBooleanDifference",
  "Brep.CreateFilletEdges",
  "Brep.CreateOffsetBrep",
  "Mesh.CreateFromBrep",
] as const;

/** What the agent is told about `python_run`. */
export function pythonRunDescription(): string {
  return `Runs a Python 3 script in a Python environment that HAI manages in this project (it needs no Rhino), shows the user the whole script and every package it would install first, and returns what it printed, the value of a variable named \`result\` (if you set one) and any error with the end of its traceback. The working folder is the project folder. Output is cut at 20000 characters; a run is ended after timeoutSeconds (default 60, at most 600) or when the user presses Stop. Every run is kept in the project as a readable script the user can open and rerun.

Packages: rhino3dm, ladybug-core and numpy are installed on first use. For anything else name it in "packages" (for example "shapely" or "ifcopenshell"); the user approves the list, and it is installed on their machine from PyPI. A package name may carry one version rule ("numpy==2.1.0"); nothing else is accepted.

MODELLING WITHOUT RHINO (rhino3dm, the openNURBS library): you can build NURBS curves and surfaces from control points and knots, Breps from surfaces, revolves, boxes, spheres and cylinders, planar trimmed shapes and extrusions (${WORKBENCH_CAN.join(", ")}), with layers, names and colours, and write or read a .3dm file. You CANNOT loft, sweep, boolean (union, difference, intersection), fillet, offset or intersect Breps, or mesh a Brep (${WORKBENCH_CANNOT.join(", ")} do not exist here). When the task needs those, build the shape from control points yourself, or say so and, if Rhino is connected, use rhino_run_python, which has all of RhinoCommon.

SAVING GEOMETRY SO THE USER CAN SEE IT: HAI's viewer draws only the render meshes a file stores, and rhino3dm stores none. Save through the helper, which adds them (a planar face is triangulated from its outline, an untrimmed surface is meshed on a grid) and then writes the file:
    import rhino3dm as r, hai_3dm
    model = r.File3dm()
    hai_3dm.add(model, brep_or_extrusion, "Canopy", "Roof", (60, 110, 200))   # name, layer, colour
    hai_3dm.save(model, "canopy.3dm")                                          # prints what it meshed
Curves (NURBS curves, polylines, circles and arcs added with hai_3dm.add) are drawn in the viewer as thin tubes along them, and stay real curves in the file. Lengths are millimetres, Z up. A trimmed free-form face from a file Rhino wrote keeps the mesh Rhino stored; one without a mesh is reported and left out. When a run leaves a new or changed .3dm in the project, the user is offered Import into viewer; nothing is imported until they choose it, and this tool never changes the HAI scene by itself.`;
}
