using System;
using System.Collections.Generic;
using System.Linq;

namespace HAI.Rhino.Core.Mesh
{
    /// <summary>Joins meshes and makes low-detail copies of them, as the importer does (apps/web/src/import/reduce-mesh.ts).</summary>
    public static class MeshReducer
    {
        /// <summary>A part this small keeps its shape: there is nothing to gain from reducing it.</summary>
        private const int SmallPartTriangles = 12;

        /// <summary>One part holding all of these.</summary>
        public static MeshPart Merge(IReadOnlyList<MeshPart> parts)
        {
            if (parts.Count == 1) return parts[0];
            var vertexNumbers = 0;
            var indexCount = 0;
            foreach (var part in parts)
            {
                vertexNumbers += part.Positions.Length;
                indexCount += part.Indices.Length;
            }

            var positions = new float[vertexNumbers];
            var indices = new uint[indexCount];
            var v = 0;
            var i = 0;
            foreach (var part in parts)
            {
                Array.Copy(part.Positions, 0, positions, v, part.Positions.Length);
                var first = (uint)(v / 3);
                foreach (var index in part.Indices) indices[i++] = index + first;
                v += part.Positions.Length;
            }

            return new MeshPart(positions, indices);
        }

        /// <summary>
        /// A low-detail copy: a grid is laid over the mesh, with this many cells along its longest side, and the vertices in a
        /// cell become one at their average. Triangles that collapse, or land on one already kept, go. It keeps the outline
        /// and the mass, not edges or thin detail.
        /// </summary>
        public static MeshPart Reduce(MeshPart mesh, int cells)
        {
            if (mesh.Triangles <= SmallPartTriangles) return mesh;
            var min = new[] { float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity };
            var max = new[] { float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity };
            for (var i = 0; i < mesh.Positions.Length; i += 3)
            {
                for (var axis = 0; axis < 3; axis++)
                {
                    var value = mesh.Positions[i + axis];
                    if (value < min[axis]) min[axis] = value;
                    if (value > max[axis]) max[axis] = value;
                }
            }

            var longest = Math.Max(max[0] - min[0], Math.Max(max[1] - min[1], max[2] - min[2]));
            if (longest <= 0) return mesh;
            var size = (double)longest / cells;

            int CellOf(int i, int axis) => Math.Min(cells - 1, (int)((mesh.Positions[i + axis] - min[axis]) / size));

            // Each cell in use: where its vertices add up to, and how many there are.
            var slotOfCell = new Dictionary<long, int>();
            var sums = new List<double>();
            var counts = new List<int>();
            var slots = new int[mesh.Positions.Length / 3];
            for (var i = 0; i < mesh.Positions.Length; i += 3)
            {
                var cell = CellOf(i, 0) + ((long)CellOf(i, 1) * cells) + ((long)CellOf(i, 2) * cells * cells);
                if (!slotOfCell.TryGetValue(cell, out var slot))
                {
                    slot = counts.Count;
                    slotOfCell[cell] = slot;
                    sums.Add(0);
                    sums.Add(0);
                    sums.Add(0);
                    counts.Add(0);
                }

                slots[i / 3] = slot;
                sums[slot * 3] += mesh.Positions[i];
                sums[(slot * 3) + 1] += mesh.Positions[i + 1];
                sums[(slot * 3) + 2] += mesh.Positions[i + 2];
                counts[slot]++;
            }

            var positions = new float[counts.Count * 3];
            for (var slot = 0; slot < counts.Count; slot++)
            {
                for (var axis = 0; axis < 3; axis++) positions[(slot * 3) + axis] = (float)(sums[(slot * 3) + axis] / counts[slot]);
            }

            var kept = new HashSet<(int, int, int)>();
            var indices = new List<uint>();
            for (var i = 0; i < mesh.Indices.Length; i += 3)
            {
                var a = slots[mesh.Indices[i]];
                var b = slots[mesh.Indices[i + 1]];
                var c = slots[mesh.Indices[i + 2]];
                if (a == b || b == c || a == c) continue;
                // The same three corners in any order are one triangle, or the two sides of one.
                var low = Math.Min(a, Math.Min(b, c));
                var high = Math.Max(a, Math.Max(b, c));
                if (!kept.Add((low, a + b + c - low - high, high))) continue;
                indices.Add((uint)a);
                indices.Add((uint)b);
                indices.Add((uint)c);
            }

            return new MeshPart(positions, indices.ToArray());
        }
    }

    /// <summary>One kind of block in a model: how many times it is placed and how many triangles one placement has.</summary>
    public sealed class BlockWeight
    {
        public Guid Id { get; }
        public int Placements { get; }
        public long Triangles { get; }

        public BlockWeight(Guid id, int placements, long triangles)
        {
            Id = id;
            Placements = placements;
            Triangles = triangles;
        }
    }

    /// <summary>Which blocks to draw with less detail, and how finely.</summary>
    public sealed class BlockPlan
    {
        public static readonly BlockPlan Exact = new BlockPlan(new HashSet<Guid>(), 0);

        public IReadOnlyCollection<Guid> Reduced { get; }
        public int Cells { get; }

        public BlockPlan(IReadOnlyCollection<Guid> reduced, int cells)
        {
            Reduced = reduced;
            Cells = cells;
        }

        public bool SameAs(BlockPlan other) =>
            Cells == other.Cells && Reduced.Count == other.Reduced.Count && Reduced.All(other.Reduced.Contains);
    }

    /// <summary>
    /// Keeps a mirrored model within what a browser can draw, by the rule the importer uses
    /// (apps/web/src/import/convert.ts): a model under the budget stays exact; otherwise blocks placed more than once are
    /// simplified, the heaviest in the model first, until the exact geometry left is a fifth of the budget, as finely as
    /// will fit. A block placed once is part of the design and stays exact, even if that leaves the model over the budget.
    /// </summary>
    public static class BlockBudget
    {
        public const long ModelTriangles = 5_000_000;
        private const int MinPlacements = 2;
        private const double ExactShare = 0.2;
        private const double ReducedShare = 0.9;
        private static readonly int[] GridSteps = { 48, 32, 24, 16, 12, 8, 6, 4, 3, 2 };

        /// <param name="blocks">Every kind of block placed in the model.</param>
        /// <param name="other">The triangles of everything that is not a block.</param>
        /// <param name="budget">The most triangles to draw.</param>
        /// <param name="reducedTriangles">The triangles of one placement of this block at this many grid cells.</param>
        public static BlockPlan Plan(
            IReadOnlyCollection<BlockWeight> blocks,
            long other,
            long budget,
            Func<Guid, int, long> reducedTriangles)
        {
            var exact = other;
            foreach (var block in blocks) exact += block.Placements * block.Triangles;
            if (exact <= budget) return BlockPlan.Exact;

            var heaviestFirst = new List<BlockWeight>();
            foreach (var block in blocks)
                if (block.Placements >= MinPlacements) heaviestFirst.Add(block);
            heaviestFirst.Sort((a, b) => (b.Placements * b.Triangles).CompareTo(a.Placements * a.Triangles));

            var chosen = new List<BlockWeight>();
            foreach (var block in heaviestFirst)
            {
                if (exact <= budget * ExactShare) break;
                chosen.Add(block);
                exact -= block.Placements * block.Triangles;
            }

            if (chosen.Count == 0) return BlockPlan.Exact;
            var ids = new HashSet<Guid>();
            foreach (var block in chosen) ids.Add(block.Id);
            foreach (var cells in GridSteps)
            {
                var total = exact;
                foreach (var block in chosen) total += block.Placements * reducedTriangles(block.Id, cells);
                if (total <= budget * ReducedShare) return new BlockPlan(ids, cells);
            }

            // Nothing fits: the coarsest copy is the closest there is, and better than a model that cannot be drawn.
            return new BlockPlan(ids, GridSteps[GridSteps.Length - 1]);
        }
    }
}
