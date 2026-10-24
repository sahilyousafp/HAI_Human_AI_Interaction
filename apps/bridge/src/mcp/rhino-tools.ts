import { isPackageSpec } from "../python/python-env.ts";

/**
 * The `# r: package` lines of a script, which Rhino installs before it runs: `# r: ladybug-core, numpy==2.1`. The bridge
 * reads them first so the approval card lists exactly what the run would install.
 */
export function requirementPackages(code: string): { packages: string[]; invalid: string[] } {
  const packages: string[] = [];
  const invalid: string[] = [];
  for (const line of code.split(/\r?\n/)) {
    const match = /^\s*#\s*r:\s*(.+?)\s*$/i.exec(line);
    if (!match) continue;
    for (const spec of (match[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      (isPackageSpec(spec) ? packages : invalid).push(spec);
    }
  }
  return { packages: [...new Set(packages)], invalid };
}

/** What the agent is told about `rhino_run_python`. */
export const RHINO_RUN_DESCRIPTION = `Runs a Python 3 script inside the user's open Rhino 8 document, with all of RhinoCommon, rhinoscriptsyntax and scriptcontext: you can loft, sweep, boolean, fillet, offset, intersect, mesh, move, rotate, mirror and array, build SubDs, work with layers and attributes, and do many operations in one run with loops. The user sees the whole script and every package first (name packages on "# r: package" comment lines at the top, for example "# r: ladybug-core"). The run is ONE Rhino undo step, labelled with your name and the title, and returns what it printed, the value of a variable named \`result\` (if you set one) and any error with the end of its traceback. A run blocks Rhino's window while it works, so keep it short and split big jobs; it is ended after timeoutSeconds (default 60, at most 600) or when the user presses Stop.

The user sees the Rhino model in HAI's viewer, drawn from what Rhino has: objects you add, change or delete appear there within a fraction of a second, so do not ask them to look at Rhino. Lengths are in the document's units (read them with rhino_get_document). Tag the objects or parts you make so work can be told apart: obj.Attributes.SetUserString("hai.owner", "<your name>") (keys that start with "hai." are shown to the user's HAI and to other agents). Curves, points and annotations are not drawn in HAI's viewer, so prefer surfaces and solids when the user needs to see something.`;

/** What the agent is told about `rhino_get_document`. */
export const RHINO_DOCUMENT_DESCRIPTION =
  "Reads the open Rhino document without running anything you wrote: its units, its layers (full path, colour, visibility, object counts), how many objects of each type it has, which are selected, and the active view. Call it before you write a script so you use the right units and layers.";

/**
 * The script `rhino_get_document` runs inside Rhino. It reads and changes nothing. Kept here as text because it runs in
 * Rhino's Python, not in the bridge.
 */
export const RHINO_DOCUMENT_SCRIPT = `import json
import scriptcontext as sc
import Rhino

doc = sc.doc
counts = {}
for obj in doc.Objects:
    key = str(obj.ObjectType)
    counts[key] = counts.get(key, 0) + 1
layers = []
for layer in doc.Layers:
    if layer.IsDeleted:
        continue
    layers.append({
        "path": layer.FullPath,
        "visible": layer.IsVisible,
        "color": "#%02x%02x%02x" % (layer.Color.R, layer.Color.G, layer.Color.B),
        "objects": len(doc.Objects.FindByLayer(layer) or []),
    })
selected = []
for obj in doc.Objects.GetSelectedObjects(False, False):
    selected.append({"id": str(obj.Id), "type": str(obj.ObjectType), "layer": doc.Layers[obj.Attributes.LayerIndex].FullPath, "name": obj.Attributes.Name or ""})
view = doc.Views.ActiveView
result = json.dumps({
    "name": doc.Name or "",
    "units": str(doc.ModelUnitSystem),
    "tolerance": doc.ModelAbsoluteTolerance,
    "layers": layers,
    "objectCounts": counts,
    "selected": selected[:200],
    "selectedCount": len(selected),
    "activeView": view.ActiveViewport.Name if view else None,
})
`;
