using System.Collections.Generic;
using System.Linq;
using HAI.Rhino.Core.Api;
using HAI.Rhino.Core.Describe;
using Xunit;

namespace HAI.Rhino.Core.Tests
{
    public class ApiIndexTests
    {
        private static ApiIndex Index(params string[] names)
        {
            var index = new ApiIndex();
            index.Add(names.Select(n => ApiIndex.Entry(n, "method", n + "(...)", null)));
            index.Finish();
            return index;
        }

        [Fact]
        public void LookUpARhinoMethodByItsDottedTailFindsItFirst()
        {
            var index = Index(
                "Rhino.Geometry.Brep.CreateFromLoftRebuild",
                "Rhino.Geometry.Brep.CreateFromLoft",
                "Rhino.Geometry.NurbsSurface.CreateFromLoft",
                "Rhino.Geometry.Curve.CreateBlendCurve");
            var found = index.Find("api-1", "Brep.CreateFromLoft");
            Assert.Equal("Rhino.Geometry.Brep.CreateFromLoft", found.Entries[0].Name);
            Assert.Equal("api-1", found.Id);
            Assert.False(found.Partial);
        }

        [Fact]
        public void AMembersOwnNameComesBeforeNamesThatOnlyContainIt()
        {
            var index = Index("Rhino.Geometry.LoftType", "Rhino.Geometry.Brep.CreateFromLoft", "Rhino.Geometry.Brep.Loft");
            var names = index.Find("q", "loft").Entries.Select(e => e.Name).ToList();
            Assert.Equal("Rhino.Geometry.Brep.Loft", names[0]);
            Assert.Equal(3, names.Count);
        }

        [Fact]
        public void IgnoresCaseAndFindsNothingForNothing()
        {
            var index = Index("Rhino.Geometry.Brep.CreateFromLoft");
            Assert.Single(index.Find("q", "createfromloft").Entries);
            Assert.Empty(index.Find("q", "  ").Entries);
            Assert.Empty(index.Find("q", "Sweep").Entries);
        }

        [Fact]
        public void AnswersAtMostFiftyAndSaysWhenThereWereMore()
        {
            var index = Index(Enumerable.Range(0, 80).Select(i => $"Rhino.Geometry.Thing{i}.Make").ToArray());
            var found = index.Find("q", "Make");
            Assert.Equal(50, found.Entries.Count);
            Assert.True(found.Truncated);
        }

        [Fact]
        public void BeforeTheIndexIsBuiltTheAnswerIsMarkedPartial()
        {
            var index = new ApiIndex();
            index.Add(new[] { ApiIndex.Entry("Rhino.RhinoDoc", "type", "class RhinoDoc", "The document.") });
            Assert.True(index.Find("q", "RhinoDoc").Partial);
            index.Finish();
            Assert.False(index.Find("q", "RhinoDoc").Partial);
        }

        [Fact]
        public void EntriesAreClippedToWhatTheBridgeAccepts()
        {
            var entry = ApiIndex.Entry(new string('n', 400), "method", new string('s', 1500), "   ");
            Assert.Equal(300, entry.Name.Length);
            Assert.Equal(1000, entry.Signature.Length);
            Assert.Null(entry.Summary);
        }
    }

    public class ComponentPropertiesTests
    {
        private static KeyValuePair<string?, string?> P(string? key, string? value) =>
            new KeyValuePair<string?, string?>(key, value);

        [Fact]
        public void TheUserStringsBecomeProperties()
        {
            var properties = ComponentProperties.From(new[] { P("hai.part", "canopy"), P("fireRating", "60"), P("note", null) });
            Assert.Equal("canopy", properties["hai.part"]);
            Assert.Equal("60", properties["fireRating"]);
            Assert.Equal("", properties["note"]);
        }

        [Fact]
        public void AtMostOneHundredPropertiesEachValueAtMostTwoHundredCharacters()
        {
            var many = Enumerable.Range(0, 150).Select(i => P($"p{i}", new string('x', 300)));
            var properties = ComponentProperties.From(many);
            Assert.Equal(100, properties.Count);
            Assert.All(properties.Values, v => Assert.Equal(200, v.Length));
        }

        [Fact]
        public void EmptyKeysAreLeftOutAndARepeatedKeyKeepsItsFirstValue()
        {
            var properties = ComponentProperties.From(new[] { P("", "a"), P(null, "b"), P(" k ", "1"), P("k", "2") });
            Assert.Single(properties);
            Assert.Equal("1", properties["k"]);
        }

        [Fact]
        public void HeavyGeometryIsDescribedWithoutQuantities()
        {
            Assert.True(ComponentProperties.QuickToMeasure(6, isMesh: false));
            Assert.False(ComponentProperties.QuickToMeasure(5000, isMesh: false));
            Assert.True(ComponentProperties.QuickToMeasure(100_000, isMesh: true));
            Assert.False(ComponentProperties.QuickToMeasure(1_000_000, isMesh: true));
        }
    }
}
