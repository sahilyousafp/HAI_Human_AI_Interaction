using System;
using System.Collections.Generic;
using System.Linq;
using HAI.Rhino.Core.Mesh;
using Xunit;

namespace HAI.Rhino.Core.Tests
{
    public class MeshReducerTests
    {
        /// <summary>A flat sheet of n by n squares, 10 units each.</summary>
        private static MeshPart Sheet(int n)
        {
            var positions = new List<float>();
            var indices = new List<uint>();
            for (var y = 0; y <= n; y++)
            {
                for (var x = 0; x <= n; x++) positions.AddRange(new float[] { x * 10, y * 10, 0 });
            }

            uint At(int x, int y) => (uint)((y * (n + 1)) + x);
            for (var y = 0; y < n; y++)
            {
                for (var x = 0; x < n; x++)
                    indices.AddRange(new[] { At(x, y), At(x + 1, y), At(x + 1, y + 1), At(x, y), At(x + 1, y + 1), At(x, y + 1) });
            }

            return new MeshPart(positions.ToArray(), indices.ToArray());
        }

        [Fact]
        public void ADenseMeshGetsMuchSmallerAndFewerCellsSmallerStill()
        {
            var dense = Sheet(100);
            var fine = MeshReducer.Reduce(dense, 32);
            var coarse = MeshReducer.Reduce(dense, 8);
            Assert.Equal(20_000, dense.Triangles);
            Assert.True(fine.Triangles < 2500, $"{fine.Triangles}");
            Assert.True(coarse.Triangles < fine.Triangles);
            Assert.True(coarse.Triangles > 0);
        }

        [Fact]
        public void AReducedMeshStaysWhereItWas()
        {
            var xs = MeshReducer.Reduce(Sheet(100), 8).Positions.Where((_, i) => i % 3 == 0).ToList();
            Assert.InRange(xs.Min(), 0, 70);
            Assert.InRange(xs.Max(), 930, 1000);
        }

        [Fact]
        public void ASmallPartIsLeftAsItIs()
        {
            var small = Sheet(2);
            Assert.Same(small, MeshReducer.Reduce(small, 2));
        }

        [Fact]
        public void AMeshWithNoSizeIsLeftAsItIs()
        {
            var point = new MeshPart(Enumerable.Repeat(5f, 60).ToArray(), Enumerable.Range(0, 60).Select(i => (uint)(i % 20)).ToArray());
            Assert.Same(point, MeshReducer.Reduce(point, 8));
        }

        [Fact]
        public void MergedPartsKeepTheirOwnVertices()
        {
            var a = new MeshPart(new float[] { 0, 0, 0, 1, 0, 0, 0, 1, 0 }, new uint[] { 0, 1, 2 });
            var b = new MeshPart(new float[] { 5, 0, 0, 6, 0, 0, 5, 1, 0 }, new uint[] { 0, 1, 2 });
            var merged = MeshReducer.Merge(new[] { a, b });
            Assert.Equal(new uint[] { 0, 1, 2, 3, 4, 5 }, merged.Indices);
            Assert.Equal(5f, merged.Positions[9]);
        }
    }

    public class BlockBudgetTests
    {
        private static readonly Guid Tree = Guid.NewGuid();
        private static readonly Guid Shrub = Guid.NewGuid();
        private static readonly Guid Hall = Guid.NewGuid();

        private static long PerCell(Guid _, int cells) => cells * 10L;

        [Fact]
        public void AModelUnderTheBudgetStaysExact()
        {
            var plan = BlockBudget.Plan(new[] { new BlockWeight(Tree, 10, 100) }, 500, 10_000, PerCell);
            Assert.Empty(plan.Reduced);
        }

        [Fact]
        public void TheHeaviestRepeatedBlocksAreSimplifiedAndTheRestStayExact()
        {
            var plan = BlockBudget.Plan(
                new[] { new BlockWeight(Tree, 100, 10_000), new BlockWeight(Shrub, 2, 50), new BlockWeight(Hall, 1, 10_000) },
                1000,
                100_000,
                PerCell);
            Assert.Equal(new[] { Tree }, plan.Reduced.ToArray());
        }

        [Fact]
        public void TheFinestDetailThatFitsIsUsed()
        {
            // 40 000 exact, a budget of 100 000 and 90% of it to fill: 500 triangles a placement over 100 is the most.
            var plan = BlockBudget.Plan(new[] { new BlockWeight(Tree, 100, 10_000) }, 19_000, 100_000, (_, cells) => cells * 20L);
            Assert.Equal(32, plan.Cells);
        }

        [Fact]
        public void ABlockPlacedOnceIsNeverSimplified()
        {
            var plan = BlockBudget.Plan(new[] { new BlockWeight(Hall, 1, 500_000) }, 0, 100_000, PerCell);
            Assert.Empty(plan.Reduced);
        }

        [Fact]
        public void WhenNothingFitsTheCoarsestIsUsed()
        {
            var plan = BlockBudget.Plan(new[] { new BlockWeight(Tree, 1000, 10_000) }, 0, 100_000, (_, cells) => 5000);
            Assert.Equal(2, plan.Cells);
            Assert.Single(plan.Reduced);
        }

        [Fact]
        public void PlansCompareByWhatTheyDo()
        {
            var one = new BlockPlan(new HashSet<Guid> { Tree, Shrub }, 8);
            Assert.True(one.SameAs(new BlockPlan(new HashSet<Guid> { Shrub, Tree }, 8)));
            Assert.False(one.SameAs(new BlockPlan(new HashSet<Guid> { Tree, Shrub }, 6)));
            Assert.False(one.SameAs(new BlockPlan(new HashSet<Guid> { Tree }, 8)));
            Assert.False(one.SameAs(BlockPlan.Exact));
        }
    }
}
