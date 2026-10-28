"""OpenCascade recipes for HAI's geometry tools: loft, sweep, boolean and offset.

The bridge never calls this directly. A geometry tool writes a request as JSON, runs a short kept script in the managed
Python environment that calls `run(request_path, result_path)`, and reads the result back:

    import hai_occ
    result = hai_occ.run("request.json", "result.json")

Requests (lengths are millimetres, Z up; a "curve" is {"points": [[x, y, z], ...], "closed": bool}):

    {"recipe": "loft", "sections": [curve, ...], "ruled": bool}
    {"recipe": "sweep", "profile": curve, "rail": curve, "smooth": bool}
    {"recipe": "boolean", "op": "union" | "difference" | "intersection", "a": [solid, ...], "b": [solid, ...]}
    {"recipe": "offset", "curve": curve, "distance": number, "corners": "sharp" | "round"}

A solid is the extrusion of a footprint: {"outline": [[x, y], ...], "z0": number, "z1": number}.

The result file holds {"ok": true, ...} or {"ok": false, "error": text}. A loft, sweep or boolean answers with
"parts" ([{"positions": [x, y, z, ...], "indices": [a, b, c, ...]}], a triangle mesh), "volume" (mm3, solids only) and
"valid"; an offset answers with "curves". What can be wrong with the request is reported as `ok: false`; anything else
is a bug and raises.
"""
import json
import math

from OCP.BRep import BRep_Tool
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakePolygon,
    BRepBuilderAPI_MakeWire,
    BRepBuilderAPI_RightCorner,
    BRepBuilderAPI_RoundCorner,
)
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeOffset, BRepOffsetAPI_MakePipeShell, BRepOffsetAPI_ThruSections
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.BRepTools import BRepTools_WireExplorer
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.GCPnts import GCPnts_QuasiUniformDeflection
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.GProp import GProp_GProps
from OCP.GeomAPI import GeomAPI_Interpolate
from OCP.GeomAbs import GeomAbs_Arc, GeomAbs_Intersection
from OCP.collections import HArray1_gp_Pnt
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED, TopAbs_WIRE
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt, gp_Vec

# A point closer than this to the one before it is the same point.
_SAME = 1e-6
# More triangles than this is not a model the viewer can use.
MAX_TRIANGLES = 400_000


class RequestError(ValueError):
    """What is wrong with a request, in words the agent can act on."""


# --- building ----------------------------------------------------------------------------------------------------


def _distinct(points, closed):
    """The points with repeats removed (and a closing repeat of the first point), as (x, y, z) tuples."""
    out = []
    for p in points:
        q = (float(p[0]), float(p[1]), float(p[2]) if len(p) > 2 else 0.0)
        if not out or math.dist(out[-1], q) > _SAME:
            out.append(q)
    if closed and len(out) > 1 and math.dist(out[0], out[-1]) <= _SAME:
        out.pop()
    return out


def _wire(curve, smooth=False, what="curve"):
    """A wire through a curve's points: straight segments, or one smooth spline when `smooth` and open."""
    closed = bool(curve.get("closed"))
    points = _distinct(curve["points"], closed)
    if len(points) < (3 if closed else 2):
        raise RequestError(f"The {what} needs at least {3 if closed else 2} different points.")
    if smooth and not closed:
        if len(points) < 3:
            raise RequestError(f"A smooth {what} needs at least 3 points.")
        array = HArray1_gp_Pnt(1, len(points))
        for i, (x, y, z) in enumerate(points, start=1):
            array.SetValue(i, gp_Pnt(x, y, z))
        interpolation = GeomAPI_Interpolate(array, False, 1e-6)
        interpolation.Perform()
        if not interpolation.IsDone():
            raise RequestError(f"The {what} could not be fitted with a smooth curve.")
        return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(interpolation.Curve()).Edge()).Wire()
    polygon = BRepBuilderAPI_MakePolygon()
    for x, y, z in points:
        polygon.Add(gp_Pnt(x, y, z))
    if closed:
        polygon.Close()
    if not polygon.IsDone():
        raise RequestError(f"The {what} could not be made into a wire.")
    return polygon.Wire()


def _prism(solid):
    outline = _distinct([(x, y, 0.0) for x, y in solid["outline"]], True)
    if len(outline) < 3:
        raise RequestError("A solid needs an outline of at least 3 different points.")
    z0, z1 = float(solid["z0"]), float(solid["z1"])
    if z1 - z0 <= _SAME:
        raise RequestError("A solid needs a height above zero.")
    polygon = BRepBuilderAPI_MakePolygon()
    for x, y, _ in outline:
        polygon.Add(gp_Pnt(x, y, z0))
    polygon.Close()
    face = BRepBuilderAPI_MakeFace(polygon.Wire(), True)
    if not face.IsDone():
        raise RequestError("A solid's outline must be flat and must not cross itself.")
    return BRepPrimAPI_MakePrism(face.Face(), gp_Vec(0, 0, z1 - z0)).Shape()


# --- meshing -----------------------------------------------------------------------------------------------------


def _deflection(shape):
    """How far a mesh may stray from the true surface: a thousandth of the shape's size, at least a tenth of a mm."""
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    if box.IsVoid():
        return 0.1
    low, high = box.CornerMin(), box.CornerMax()
    return max(0.1, low.Distance(high) / 1000)


def mesh(shape):
    """The shape as one triangle mesh {"positions", "indices"}, faces outward."""
    BRepMesh_IncrementalMesh(shape, _deflection(shape), False, 0.3, True)
    positions, indices = [], []
    faces = TopExp_Explorer(shape, TopAbs_FACE)
    while faces.More():
        face = TopoDS.Face(faces.Current())
        faces.Next()
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation_s(face, location)
        if triangulation is None:
            continue
        transform = location.Transformation()
        base = len(positions) // 3
        for i in range(1, triangulation.NbNodes() + 1):
            p = triangulation.Node(i).Transformed(transform)
            positions.extend((round(p.X(), 3), round(p.Y(), 3), round(p.Z(), 3)))
        flip = face.Orientation() == TopAbs_REVERSED
        for i in range(1, triangulation.NbTriangles() + 1):
            a, b, c = triangulation.Triangle(i).Get()
            if flip:
                b, c = c, b
            indices.extend((base + a - 1, base + b - 1, base + c - 1))
    if len(indices) // 3 > MAX_TRIANGLES:
        raise RequestError(
            f"The result has {len(indices) // 3} triangles; more than {MAX_TRIANGLES} cannot be shown. Use simpler input."
        )
    return {"positions": positions, "indices": indices}


def _answer(shape, solid):
    """A shape as the result of a recipe: its mesh, its volume (solids) and whether OpenCascade finds it valid."""
    part = mesh(shape)
    if not part["indices"]:
        raise RequestError("The operation made no geometry.")
    answer = {"ok": True, "parts": [part], "valid": bool(BRepCheck_Analyzer(shape).IsValid())}
    if solid:
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(shape, props)
        answer["volume"] = round(abs(props.Mass()), 3)
    return answer


# --- recipes -----------------------------------------------------------------------------------------------------


def loft(request):
    sections = request.get("sections") or []
    if len(sections) < 2:
        raise RequestError("A loft needs at least 2 sections.")
    closed = {bool(s.get("closed")) for s in sections}
    if len(closed) > 1:
        raise RequestError("The sections of a loft must all be closed or all be open.")
    solid = closed == {True}
    thru = BRepOffsetAPI_ThruSections(solid, bool(request.get("ruled")), 1e-6)
    for i, section in enumerate(sections, start=1):
        thru.AddWire(_wire(section, what=f"section {i}"))
    thru.Build()
    if not thru.IsDone():
        raise RequestError(
            "The sections could not be lofted. Draw them in the order they are to be joined, and keep their shapes alike."
        )
    return _answer(thru.Shape(), solid)


def sweep(request):
    profile, rail = request.get("profile"), request.get("rail")
    if not profile or not rail:
        raise RequestError("A sweep needs a profile and a rail.")
    if rail.get("closed"):
        raise RequestError("The rail must be an open line.")
    shell = BRepOffsetAPI_MakePipeShell(_wire(rail, bool(request.get("smooth")), "rail"))
    shell.SetMode(False)
    shell.SetTransitionMode(BRepBuilderAPI_RightCorner)
    shell.Add(_wire(profile, what="profile"), False, False)
    shell.Build()
    if not shell.IsDone():
        raise RequestError(
            "The profile could not be swept along the rail. Draw the profile at the start of the rail, across it."
        )
    solid = bool(profile.get("closed"))
    if solid:
        shell.MakeSolid()
    return _answer(shell.Shape(), solid)


_BOOLEANS = {"union": BRepAlgoAPI_Fuse, "difference": BRepAlgoAPI_Cut, "intersection": BRepAlgoAPI_Common}


def boolean(request):
    op = request.get("op")
    if op not in _BOOLEANS:
        raise RequestError("op must be union, difference or intersection.")
    a, b = request.get("a") or [], request.get("b") or []
    if not a or not b:
        raise RequestError("A boolean needs at least one solid on each side.")
    shape = _prism(a[0])
    for solid in a[1:]:
        shape = _checked(BRepAlgoAPI_Fuse(shape, _prism(solid)), "union of the first group")
    tool = _prism(b[0])
    for solid in b[1:]:
        tool = _checked(BRepAlgoAPI_Fuse(tool, _prism(solid)), "union of the second group")
    return _answer(_checked(_BOOLEANS[op](shape, tool), op), True)


def _checked(operation, what):
    operation.Build()
    if not operation.IsDone():
        raise RequestError(f"The {what} failed. Check that the solids are valid and overlap as expected.")
    return operation.Shape()


def _edge_points(edge, keep_first):
    curve = BRepAdaptor_Curve(edge)
    sampler = GCPnts_QuasiUniformDeflection(curve, 0.05)
    if sampler.IsDone() and sampler.NbPoints() >= 2:
        points = [sampler.Value(i) for i in range(1, sampler.NbPoints() + 1)]
    else:
        points = [curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())]
    return points if keep_first else points[1:]


def _is_straight(points):
    """Whether all the points lie on one line."""
    pts = _distinct(points, False)
    a, b = pts[0], pts[-1]
    axis = [b[k] - a[k] for k in range(3)]
    length = math.sqrt(sum(v * v for v in axis))
    if length <= _SAME:
        return False
    for p in pts[1:-1]:
        d = [p[k] - a[k] for k in range(3)]
        cross = [d[1] * axis[2] - d[2] * axis[1], d[2] * axis[0] - d[0] * axis[2], d[0] * axis[1] - d[1] * axis[0]]
        if math.sqrt(sum(v * v for v in cross)) / length > _SAME * 1000:
            return False
    return True


def _offset_straight(points, distance):
    """A straight line has no plane of its own for OpenCascade to offset in: it moves sideways in plan, to the right."""
    pts = _distinct(points, False)
    (ax, ay, _), (bx, by, _) = pts[0], pts[-1]
    length = math.hypot(bx - ax, by - ay)
    if length <= _SAME:
        raise RequestError("A vertical line has no side in plan to be offset to.")
    nx, ny = (by - ay) / length * distance, -(bx - ax) / length * distance
    moved = [[round(x + nx, 3), round(y + ny, 3), round(z, 3)] for x, y, z in pts]
    return {"ok": True, "curves": [{"points": moved, "closed": False}]}


def offset(request):
    curve = request.get("curve")
    distance = float(request.get("distance", 0))
    if not curve or abs(distance) <= _SAME:
        raise RequestError("An offset needs a curve and a distance that is not zero.")
    closed = bool(curve.get("closed"))
    wire = _wire(curve)
    join = GeomAbs_Arc if request.get("corners") == "round" else GeomAbs_Intersection
    if closed:
        face = BRepBuilderAPI_MakeFace(wire, True)
        if not face.IsDone():
            raise RequestError("The curve must be flat to be offset.")
        maker = BRepOffsetAPI_MakeOffset(face.Face(), join)
    elif _is_straight(curve["points"]):
        return _offset_straight(curve["points"], distance)
    else:
        maker = BRepOffsetAPI_MakeOffset(wire, join, True)
    maker.Perform(distance)
    if not maker.IsDone():
        raise RequestError("The curve could not be offset by that distance.")
    curves = []
    wires = TopExp_Explorer(maker.Shape(), TopAbs_WIRE)
    while wires.More():
        outline = TopoDS.Wire(wires.Current())
        wires.Next()
        points = []
        edges = BRepTools_WireExplorer(outline)
        while edges.More():
            points.extend(_edge_points(edges.Current(), not points))
            edges.Next()
        wire_closed = bool(outline.Closed())
        if wire_closed and len(points) > 1 and points[0].Distance(points[-1]) <= _SAME:
            points.pop()
        curves.append(
            {"points": [[round(p.X(), 3), round(p.Y(), 3), round(p.Z(), 3)] for p in points], "closed": wire_closed}
        )
    if not curves:
        raise RequestError("Nothing is left of the curve at that distance.")
    return {"ok": True, "curves": curves}


_RECIPES = {"loft": loft, "sweep": sweep, "boolean": boolean, "offset": offset}


def run(request_path, result_path):
    """Reads a request, makes the geometry and writes the result file; returns a short summary for the run's result."""
    with open(request_path, encoding="utf-8") as handle:
        request = json.load(handle)
    recipe = _RECIPES.get(request.get("recipe"))
    try:
        if recipe is None:
            raise RequestError(f"Unknown recipe {request.get('recipe')!r}.")
        answer = recipe(request)
    except RequestError as problem:
        answer = {"ok": False, "error": str(problem)}
    with open(result_path, "w", encoding="utf-8") as handle:
        json.dump(answer, handle)
    parts = answer.get("parts") or []
    triangles = sum(len(p["indices"]) // 3 for p in parts)
    summary = {k: v for k, v in answer.items() if k in ("ok", "error", "valid", "volume")}
    summary.update({"triangles": triangles} if parts else {})
    if "curves" in answer:
        summary["curves"] = len(answer["curves"])
    return summary
