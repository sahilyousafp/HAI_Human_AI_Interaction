"""Helpers for writing .3dm files that HAI's viewer can draw, without Rhino.

rhino3dm writes Breps and extrusions with no render mesh, and HAI's viewer draws only the meshes a file stores. So
`save(model, path)` first gives every Brep face and extrusion a render mesh, then writes the file:

- a planar face is triangulated from its outline (holes included), so a disc is a disc;
- an untrimmed free-form face (a surface, a revolve, a sphere) is meshed by evaluating the surface on a grid;
- a free-form face that is trimmed cannot be meshed here (rhino3dm cannot build or cut one, so it only comes from a
  file Rhino wrote, and Rhino stored its mesh): it is left alone and reported.

    import rhino3dm as r
    import hai_3dm
    model = r.File3dm()
    ...build geometry, hai_3dm.add(model, brep, "Canopy", "Roof")...
    hai_3dm.save(model, "canopy.3dm")

`save` prints one line saying what was meshed and what was left out, so the run's output shows it.
"""
import math

import rhino3dm as r

# SetMesh keeps a pointer to the mesh it is given: the meshes must outlive the write.
_KEEP = []

_GRID = 24
_EDGE_SAMPLES = 32


def layer(model, name, color=None):
    """The index of the layer with this name, added if it is not there yet. `color` is (r, g, b)."""
    for index, existing in enumerate(model.Layers):
        if existing.Name == name:
            return index
    new = r.Layer()
    new.Name = name
    if color:
        new.Color = (color[0], color[1], color[2], 255)
    return model.Layers.Add(new)


def add(model, geometry, name=None, layer_name=None, color=None):
    """Adds a Brep, extrusion, mesh, curve or surface with a name, a layer and a colour (r, g, b); returns its id."""
    attributes = r.ObjectAttributes()
    if name:
        attributes.Name = name
    if layer_name:
        attributes.LayerIndex = layer(model, layer_name)
    if color:
        attributes.ObjectColor = (color[0], color[1], color[2], 255)
        attributes.ColorSource = r.ObjectColorSource.ColorFromObject
    objects = model.Objects
    if isinstance(geometry, r.Brep):
        return objects.AddBrep(geometry, attributes)
    if isinstance(geometry, r.Extrusion):
        return objects.AddExtrusion(geometry, attributes)
    if isinstance(geometry, r.Mesh):
        return objects.AddMesh(geometry, attributes)
    if isinstance(geometry, r.Curve):
        return objects.AddCurve(geometry, attributes)
    if isinstance(geometry, r.Surface):
        return objects.AddSurface(geometry, attributes)
    raise TypeError(f"hai_3dm.add does not know {type(geometry).__name__}")


# --- meshing ------------------------------------------------------------------------------------------------------


class _Builder:
    """Collects vertices and triangles, then makes a rhino3dm mesh."""

    def __init__(self):
        self.vertices = []
        self.triangles = []

    def add_grid(self, surface, nu=_GRID, nv=_GRID):
        du, dv = surface.Domain(0), surface.Domain(1)
        base = len(self.vertices)
        for i in range(nu + 1):
            u = du.T0 + (du.T1 - du.T0) * i / nu
            for j in range(nv + 1):
                v = dv.T0 + (dv.T1 - dv.T0) * j / nv
                p = surface.PointAt(u, v)
                self.vertices.append((p.X, p.Y, p.Z))
        for i in range(nu):
            for j in range(nv):
                a = base + i * (nv + 1) + j
                b = a + 1
                c = a + (nv + 1) + 1
                d = a + (nv + 1)
                self.triangles.append((a, b, c))
                self.triangles.append((a, c, d))

    def add_polygon(self, points3d, triangles):
        base = len(self.vertices)
        self.vertices.extend(points3d)
        for a, b, c in triangles:
            self.triangles.append((base + a, base + b, base + c))

    def mesh(self):
        mesh = r.Mesh()
        for x, y, z in self.vertices:
            mesh.Vertices.Add(x, y, z)
        for a, b, c in self.triangles:
            mesh.Faces.AddFace(a, b, c)
        mesh.Normals.ComputeNormals()
        mesh.Compact()
        return mesh


def _loop_points(brep, loop):
    """The 3D points around one loop of a face, in order, from its edges."""
    points = []
    for trim in loop.Trims:
        edge = brep.Edges[trim.EdgeIndex]
        domain = edge.Domain
        count = 2 if edge.IsLinear() else _EDGE_SAMPLES
        samples = [
            edge.PointAt(domain.T0 + (domain.T1 - domain.T0) * k / (count - 1)) for k in range(count)
        ]
        if trim.IsReversed:
            samples.reverse()
        points.extend((p.X, p.Y, p.Z) for p in samples[:-1])  # the last point is the next edge's first
    return points


def _plane_basis(points):
    """The plane through a polygon (Newell's normal) and two axes in it."""
    nx = ny = nz = 0.0
    for i, (x1, y1, z1) in enumerate(points):
        x2, y2, z2 = points[(i + 1) % len(points)]
        nx += (y1 - y2) * (z1 + z2)
        ny += (z1 - z2) * (x1 + x2)
        nz += (x1 - x2) * (y1 + y2)
    length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    n = (nx / length, ny / length, nz / length)
    helper = (1.0, 0.0, 0.0) if abs(n[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = (
        helper[1] * n[2] - helper[2] * n[1],
        helper[2] * n[0] - helper[0] * n[2],
        helper[0] * n[1] - helper[1] * n[0],
    )
    ul = math.sqrt(sum(c * c for c in u)) or 1.0
    u = tuple(c / ul for c in u)
    v = (n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0])
    return u, v


def _area2(poly):
    return sum(
        poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
        for i in range(len(poly))
    )


def _in_triangle(p, a, b, c):
    def side(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    d1, d2, d3 = side(p, a, b), side(p, b, c), side(p, c, a)
    negative = d1 < 0 or d2 < 0 or d3 < 0
    positive = d1 > 0 or d2 > 0 or d3 > 0
    return not (negative and positive)


def _ear_clip(poly):
    """Triangles (index triples) of a simple polygon given as 2D points, by ear clipping."""
    n = len(poly)
    if n < 3:
        return []
    order = list(range(n))
    if _area2(poly) < 0:
        order.reverse()
    triangles = []
    guard = 0
    while len(order) > 3 and guard < 10 * n * n:
        guard += 1
        clipped = False
        for k in range(len(order)):
            ia, ib, ic = order[k - 1], order[k], order[(k + 1) % len(order)]
            a, b, c = poly[ia], poly[ib], poly[ic]
            cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if cross <= 1e-12:
                continue
            if any(
                _in_triangle(poly[j], a, b, c)
                for j in order
                if j not in (ia, ib, ic) and poly[j] not in (a, b, c)
            ):
                continue
            triangles.append((ia, ib, ic))
            order.pop(k)
            clipped = True
            break
        if not clipped:
            break  # a degenerate polygon: what is left is dropped
    if len(order) == 3:
        triangles.append((order[0], order[1], order[2]))
    return triangles


def _bridge_holes(points, outer_count, hole_ranges):
    """The ring of point indices of one simple polygon: the outline with each hole cut in by a two-way bridge."""
    ring = list(range(outer_count))
    for start, end in sorted(hole_ranges, key=lambda r_: -max(points[k][0] for k in range(*r_))):
        ids = list(range(start, end))
        # The hole vertex furthest right sees the outline most easily; join it to the nearest outline vertex.
        m = max(ids, key=lambda k: points[k][0])
        position = min(
            range(len(ring)),
            key=lambda at: (points[ring[at]][0] - points[m][0]) ** 2 + (points[ring[at]][1] - points[m][1]) ** 2,
        )
        first = ids.index(m)
        around = ids[first:] + ids[:first]
        ring[position + 1 : position + 1] = around + [m, ring[position]]
    return ring


def _triangulate_planar(brep, face):
    """(points, triangles) for a planar face from its outline and holes, or None if it has no usable outline."""
    outer_loop = face.OuterLoop
    outer3d = _loop_points(brep, outer_loop)
    if len(outer3d) < 3:
        return None
    holes3d = [
        _loop_points(brep, loop) for loop in face.Loops if loop.LoopType != outer_loop.LoopType
    ]
    holes3d = [h for h in holes3d if len(h) >= 3]
    u, v = _plane_basis(outer3d)

    def flat(p):
        return (p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2])

    # The outline runs counter-clockwise and every hole clockwise, in the face's own plane.
    if _area2([flat(p) for p in outer3d]) < 0:
        outer3d.reverse()
    holes3d = [h if _area2([flat(p) for p in h]) < 0 else list(reversed(h)) for h in holes3d]
    points3d = list(outer3d)
    ranges = []
    for hole in holes3d:
        ranges.append((len(points3d), len(points3d) + len(hole)))
        points3d.extend(hole)
    points2d = [flat(p) for p in points3d]
    ring = _bridge_holes(points2d, len(outer3d), ranges)
    triangles = [(ring[a], ring[b], ring[c]) for a, b, c in _ear_clip([points2d[k] for k in ring])]
    return points3d, triangles


def _is_untrimmed(face):
    """A free-form face whose outline is the surface's own edge: one loop of at most four trims (singular ones included)."""
    loops = list(face.Loops)
    return len(loops) == 1 and loops[0].TrimCount <= 4


def mesh_brep(brep):
    """A render mesh for a Brep, one per face; returns (list of (face, mesh or None), problems)."""
    result = []
    problems = []
    for index, face in enumerate(brep.Faces):
        builder = _Builder()
        if face.IsPlanar():
            triangulated = _triangulate_planar(brep, face)
            if triangulated and triangulated[1]:
                builder.add_polygon(*triangulated)
            else:
                problems.append(f"face {index}: its outline could not be triangulated")
        elif _is_untrimmed(face):
            builder.add_grid(face.UnderlyingSurface() if hasattr(face, "UnderlyingSurface") else face.DuplicateSurface())
        else:
            problems.append(f"face {index}: a trimmed free-form face cannot be meshed without Rhino")
        result.append((face, builder.mesh() if builder.triangles else None))
    return result, problems


def prepare(model):
    """Gives every Brep face and extrusion that has no render mesh one. Returns a report."""
    meshed = skipped = 0
    problems = []
    for obj in model.Objects:
        geometry = obj.Geometry
        name = obj.Attributes.Name or str(obj.Attributes.Id)
        if isinstance(geometry, r.Brep):
            faces, found = mesh_brep(geometry)
            problems += [f"{name}: {p}" for p in found]
            for face, mesh in faces:
                if face.GetMesh(r.MeshType.Render) is not None:
                    continue
                if mesh is None:
                    skipped += 1
                    continue
                _KEEP.append(mesh)
                if face.SetMesh(mesh, r.MeshType.Render):
                    meshed += 1
        elif isinstance(geometry, r.Extrusion):
            if geometry.GetMesh(r.MeshType.Render) is not None:
                continue
            brep = geometry.ToBrep(True)
            builder = _Builder()
            faces, problem = mesh_brep(brep)
            problems += [f"{name}: {p}" for p in problem]
            for _, mesh in faces:
                if mesh is None:
                    continue
                base = len(builder.vertices)
                for k in range(len(mesh.Vertices)):
                    vertex = mesh.Vertices[k]
                    builder.vertices.append((vertex.X, vertex.Y, vertex.Z))
                for k in range(len(mesh.Faces)):
                    a, b, c, d = mesh.Faces[k]
                    builder.triangles.append((base + a, base + b, base + c))
                    if d != c:
                        builder.triangles.append((base + a, base + c, base + d))
            if builder.triangles:
                merged = builder.mesh()
                _KEEP.append(merged)
                if geometry.SetMesh(merged, r.MeshType.Render):
                    meshed += 1
            else:
                skipped += 1
    return {"meshed": meshed, "skipped": skipped, "problems": problems}


def save(model, path, version=8):
    """Meshes what has no mesh, writes the file (as Rhino `version` reads it) and prints what it did."""
    report = prepare(model)
    ok = model.Write(path, version)
    line = f"hai_3dm: wrote {path} ({'ok' if ok else 'FAILED'}); render meshes added: {report['meshed']}"
    if report["skipped"]:
        line += f"; objects left without a mesh: {report['skipped']}"
    print(line)
    for problem in report["problems"]:
        print(f"hai_3dm: {problem}")
    return ok
