using System;
using System.Collections.Generic;
using HAI.Rhino.Core.Mesh;
using Rhino.DocObjects;
using MeshingParameters = Rhino.Geometry.MeshingParameters;
using MeshType = Rhino.Geometry.MeshType;
using RhinoMesh = Rhino.Geometry.Mesh;

namespace HAI.Rhino.Mirror
{
    /// <summary>The triangles of one Rhino object, in millimetres, or the fact that it has too many to be mirrored.</summary>
    internal sealed class MeshedObject
    {
        public IReadOnlyList<MeshPart> Parts { get; }
        public int Triangles { get; }
        public bool TooHeavy { get; }

        public MeshedObject(IReadOnlyList<MeshPart> parts, int triangles, bool tooHeavy)
        {
            Parts = parts;
            Triangles = triangles;
            TooHeavy = tooHeavy;
        }
    }

    /// <summary>
    /// Makes the mesh HAI draws for a Rhino object: Rhino's own render mesh (a fast one, made if the object has none yet),
    /// triangulated, in millimetres with Z up. An object over the triangle cap is not meshed in full; HAI draws its
    /// bounding box and says so.
    /// </summary>
    internal static class ObjectMesher
    {
        /// <summary>The most triangles one object may have for its mesh to be sent.</summary>
        public const int TriangleCap = 200_000;

        public static MeshedObject? Mesh(RhinoObject obj, double toMillimetres)
        {
            var meshes = RenderMeshes(obj);
            var triangles = 0;
            foreach (var mesh in meshes) triangles += mesh.Faces.TriangleCount + 2 * mesh.Faces.QuadCount;
            if (meshes.Count == 0) return null;
            if (triangles > TriangleCap) return new MeshedObject(Array.Empty<MeshPart>(), triangles, true);

            var parts = new List<MeshPart>(meshes.Count);
            foreach (var mesh in meshes)
            {
                var part = ToPart(mesh, (float)toMillimetres);
                if (part != null) parts.Add(part);
            }

            return parts.Count == 0 ? null : new MeshedObject(parts, triangles, false);
        }

        private static List<RhinoMesh> RenderMeshes(RhinoObject obj)
        {
            var found = new List<RhinoMesh>();
            if (obj is MeshObject meshObject)
            {
                if (meshObject.MeshGeometry != null) found.Add(meshObject.MeshGeometry);
                return found;
            }

            // Making the render meshes once stores them on the object, so a later change costs only what changed.
            obj.CreateMeshes(MeshType.Render, MeshingParameters.FastRenderMesh, true);
            var made = obj.GetMeshes(MeshType.Render);
            if (made != null) found.AddRange(made);
            return found;
        }

        private static MeshPart? ToPart(RhinoMesh mesh, float scale)
        {
            var vertices = mesh.Vertices;
            var positions = new float[vertices.Count * 3];
            for (var i = 0; i < vertices.Count; i++)
            {
                var v = vertices[i];
                positions[i * 3] = v.X * scale;
                positions[i * 3 + 1] = v.Y * scale;
                positions[i * 3 + 2] = v.Z * scale;
                if (float.IsNaN(positions[i * 3]) || float.IsInfinity(positions[i * 3])) return null;
            }

            var indices = new List<uint>(mesh.Faces.Count * 3);
            foreach (var face in mesh.Faces)
            {
                indices.Add((uint)face.A);
                indices.Add((uint)face.B);
                indices.Add((uint)face.C);
                if (!face.IsQuad) continue;
                indices.Add((uint)face.A);
                indices.Add((uint)face.C);
                indices.Add((uint)face.D);
            }

            return indices.Count == 0 ? null : new MeshPart(positions, indices.ToArray());
        }
    }
}
