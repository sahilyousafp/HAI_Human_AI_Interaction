import type { HostId, HostLanguage } from "@hai/protocol";
import { isPackageSpec } from "../python/python-env.ts";

/**
 * What the bridge knows about one kind of host beyond the shared contract: its name, what it does best, how to connect
 * it, the language its runs are in, and how a script names the packages it would install. Adding a host is one of
 * these and its connector; nothing else in the bridge branches on the host.
 */
export interface HostAdapter {
  id: HostId;
  label: string;
  /** What the orchestrator should give this host, for `host_list` and the tools' descriptions. */
  strengths: string;
  /** How the user connects it, for the HUD and for an agent told it is not connected. */
  connectHint: string;
  language: HostLanguage;
  /** What the language gives a script inside this host, for `host_run`'s description. */
  runHint: string;
  /** The packages a script would install before it runs, for the approval card. */
  packagesOf(code: string): { packages: string[]; invalid: string[] };
  /** The script `host_read` runs (it reads and changes nothing), or null while the connector has none. */
  documentScript: string | null;
}

const NO_PACKAGES = () => ({ packages: [], invalid: [] });

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

/**
 * The script `host_read` runs inside Rhino. It reads and changes nothing. Kept here as text because it runs in Rhino's
 * Python, not in the bridge.
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

export const HOST_ADAPTERS: Record<HostId, HostAdapter> = {
  rhino: {
    id: "rhino",
    label: "Rhino",
    strengths:
      "form and NURBS: lofts, sweeps, booleans, fillets, offsets, SubD, precise surfaces and solids, fabrication geometry, Grasshopper",
    connectHint: "Run HaiConnect in Rhino.",
    language: "python",
    runHint:
      'Python 3 inside the open Rhino document, with all of RhinoCommon, rhinoscriptsyntax and scriptcontext: loft, sweep, boolean, fillet, offset, intersect, mesh, move, rotate, mirror and array, build SubDs, work with layers and attributes, and do many operations in one run with loops. Name packages on "# r: package" comment lines at the top (for example "# r: ladybug-core"). Tag what you make: obj.Attributes.SetUserString("hai.owner", "<your name>").',
    packagesOf: requirementPackages,
    documentScript: RHINO_DOCUMENT_SCRIPT,
  },
  blender: {
    id: "blender",
    label: "Blender",
    strengths:
      "visualisation and mesh work: materials, lighting, cameras and renders, modifiers, sculpting and organic forms, IFC through Bonsai",
    connectHint: "Enable the HAI add-on in Blender and press Connect in its panel.",
    language: "python",
    runHint:
      'Python inside the open Blender file, with bpy and bmesh. Tag what you make: obj["hai.owner"] = "<your name>".',
    packagesOf: NO_PACKAGES,
    documentScript: null,
  },
  revit: {
    id: "revit",
    label: "Revit",
    strengths:
      "BIM: walls, floors, roofs, doors and windows as native elements, levels and grids, families and types, parameters, schedules, sheets and views",
    connectHint: "Load the HAI add-in in Revit and press Connect on its ribbon.",
    language: "csharp",
    runHint:
      "C# compiled inside Revit, with the Revit API: the body of a method given `UIApplication app` and `Document doc`, run inside one transaction group. Tag what you make with the shared parameter hai.owner.",
    packagesOf: NO_PACKAGES,
    documentScript: null,
  },
};
