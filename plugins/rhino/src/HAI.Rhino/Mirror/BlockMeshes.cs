using System;
using System.Collections.Generic;
using System.Linq;
using HAI.Rhino.Core.Mesh;
using HAI.Rhino.Core.Protocol;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;
using MeshPart = HAI.Rhino.Core.Mesh.MeshPart;

namespace HAI.Rhino.Mirror
{
    /// <summary>The mesh of one kind of block, in the block's own coordinates: one part per colour.</summary>
    internal sealed class BlockMesh
    {
        public Guid Asset { get; }

        /// <summary>The mesh to upload, until it has been handed over: every placement after the first shares the asset.</summary>
        public byte[]? Pending { get; set; }

        /// <summary>Per part: its colour, or null for the colour of the placement ("by parent" in Rhino).</summary>
        public IReadOnlyList<string?> Colors { get; }

        public int Triangles { get; }

        public BlockMesh(Guid asset, byte[] pending, IReadOnlyList<string?> colors, int triangles)
        {
            Asset = asset;
            Pending = pending;
            Colors = colors;
            Triangles = triangles;
        }
    }

    /// <summary>
    /// The meshes of a document's blocks. Each kind of block is meshed and uploaded once, whatever its placements number,
    /// and a model too heavy to draw has its heaviest repeated blocks simplified (<see cref="BlockBudget"/>).
    /// Runs on Rhino's UI thread.
    /// </summary>
    internal sealed class BlockMeshes
    {
        /// <summary>The most triangles one block may have to be sent; more than this and it is drawn as its box.</summary>
        public const int TriangleCap = 1_000_000;

        private const int Depth = 8;

        private sealed class Piece
        {
            public string? Color;
            public MeshPart Part = null!;
        }

        private readonly RhinoDoc doc;
        private readonly double toMillimetres;
        private readonly Dictionary<Guid, List<Piece>> exact = new Dictionary<Guid, List<Piece>>();
        private readonly Dictionary<(Guid, int), List<Piece>> reduced = new Dictionary<(Guid, int), List<Piece>>();
        private readonly Dictionary<Guid, BlockMesh?> ready = new Dictionary<Guid, BlockMesh?>();
        private readonly Dictionary<Guid, int> placements = new Dictionary<Guid, int>();
        private BlockPlan plan = BlockPlan.Exact;

        public BlockMeshes(RhinoDoc doc)
        {
            this.doc = doc;
            toMillimetres = RhinoMath.UnitScale(doc.ModelUnitSystem, UnitSystem.Millimeters);
        }

        /// <summary>How many placed blocks are drawn with less detail.</summary>
        public int SimplifiedPlacements =>
            plan.Reduced.Sum(id => placements.TryGetValue(id, out var count) ? count : 0);

        /// <summary>Forgets every mesh: a block or a layer changed. The placements are sent again by the caller.</summary>
        public void Clear()
        {
            exact.Clear();
            reduced.Clear();
            ready.Clear();
        }

        /// <summary>Lets go of a mesh that did not reach the bridge, so the next placement sends it again.</summary>
        public void Forget(Guid asset)
        {
            foreach (var id in ready.Where(pair => pair.Value?.Asset == asset).Select(pair => pair.Key).ToList()) ready.Remove(id);
        }

        /// <summary>
        /// Counts the placements and decides what to simplify. Returns true when that changed the meshes already sent, so
        /// every placement has to be sent again.
        /// </summary>
        public bool Replan(IEnumerable<RhinoObject> shown)
        {
            placements.Clear();
            long other = 0;
            foreach (var obj in shown)
            {
                if (obj is InstanceObject placed)
                {
                    var id = placed.InstanceDefinition?.Id ?? Guid.Empty;
                    if (id != Guid.Empty) placements[id] = (placements.TryGetValue(id, out var count) ? count : 0) + 1;
                }
                else if (ObjectDescriber.TypeName(obj) != null)
                {
                    other += ObjectMesher.TriangleCount(obj);
                }
            }

            // A mesh no placement uses is gone from the bridge too: a new placement has to send it again.
            foreach (var id in ready.Keys.Where(id => !placements.ContainsKey(id)).ToList()) ready.Remove(id);

            var weights = placements
                .Select(pair => new BlockWeight(pair.Key, pair.Value, Exact(pair.Key).Sum(piece => (long)piece.Part.Triangles)))
                .ToList();
            var next = BlockBudget.Plan(
                weights,
                other,
                BlockBudget.ModelTriangles,
                (id, cells) => Reduced(id, cells).Sum(piece => (long)piece.Part.Triangles));
            if (next.SameAs(plan)) return false;
            plan = next;
            ready.Clear();
            return true;
        }

        /// <summary>The mesh of a block, or null when it has nothing to draw or is too heavy to send.</summary>
        public BlockMesh? For(InstanceDefinition definition)
        {
            if (ready.TryGetValue(definition.Id, out var known)) return known;
            var pieces = plan.Reduced.Contains(definition.Id) ? Reduced(definition.Id, plan.Cells) : Exact(definition.Id);
            var mesh = Build(pieces);
            ready[definition.Id] = mesh;
            return mesh;
        }

        /// <summary>The triangles a block has, drawn or not, for the count of what is too heavy.</summary>
        public int TrianglesOf(InstanceDefinition definition) => Exact(definition.Id).Sum(piece => piece.Part.Triangles);

        private static BlockMesh? Build(List<Piece> pieces)
        {
            var triangles = pieces.Sum(piece => piece.Part.Triangles);
            if (triangles == 0 || triangles > TriangleCap) return null;
            var byColor = pieces.GroupBy(piece => piece.Color).Take(Limits.PartsPerObject).ToList();
            var parts = byColor.Select(group => MeshReducer.Merge(group.Select(piece => piece.Part).ToList())).ToList();
            var colors = byColor.Select(group => group.Key).ToList();
            return new BlockMesh(Guid.NewGuid(), MeshAssetWriter.Encode(parts), colors, parts.Sum(part => part.Triangles));
        }

        private List<Piece> Reduced(Guid definition, int cells)
        {
            if (reduced.TryGetValue((definition, cells), out var known)) return known;
            var pieces = Exact(definition)
                .Select(piece => new Piece { Color = piece.Color, Part = MeshReducer.Reduce(piece.Part, cells) })
                .Where(piece => piece.Part.Triangles > 0)
                .ToList();
            reduced[(definition, cells)] = pieces;
            return pieces;
        }

        private List<Piece> Exact(Guid definition)
        {
            if (exact.TryGetValue(definition, out var known)) return known;
            var pieces = new List<Piece>();
            var found = doc.InstanceDefinitions.FindId(definition);
            if (found != null) Collect(found, Transform.Identity, 0, pieces);
            exact[definition] = pieces;
            return pieces;
        }

        // Everything a block holds, blocks inside it included, placed in the block's own coordinates, in millimetres. What
        // Rhino would not show inside a block (a hidden object, or one on a hidden layer) is not drawn here either.
        private void Collect(InstanceDefinition definition, Transform placed, int depth, List<Piece> pieces)
        {
            if (depth >= Depth) return;
            foreach (var obj in definition.GetObjects())
            {
                if (!ObjectDescriber.IsShown(doc, obj)) continue;
                if (obj is InstanceObject inner)
                {
                    if (inner.InstanceDefinition != null) Collect(inner.InstanceDefinition, placed * inner.InstanceXform, depth + 1, pieces);
                    continue;
                }

                if (ObjectDescriber.TypeName(obj) == null) continue;
                var part = ObjectMesher.Placed(obj, placed, toMillimetres);
                if (part != null) pieces.Add(new Piece { Color = ColorOf(obj), Part = part });
            }
        }

        private string? ColorOf(RhinoObject obj)
        {
            if (obj.Attributes.ColorSource == ObjectColorSource.ColorFromParent) return null;
            var color = obj.Attributes.DrawColor(doc);
            return color.IsEmpty ? null : $"#{color.R:x2}{color.G:x2}{color.B:x2}";
        }
    }
}
