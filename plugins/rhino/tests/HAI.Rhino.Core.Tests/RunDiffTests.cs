using System.Collections.Generic;
using System.Linq;
using HAI.Rhino.Core.Changes;
using HAI.Rhino.Core.Protocol;
using Xunit;

namespace HAI.Rhino.Core.Tests
{
    public class RunDiffTests
    {
        private static ObjectSnapshot Snapshot(string id, string fingerprint = "1", string name = "Object", params (string, string)[] tags) =>
            new ObjectSnapshot
            {
                Id = id,
                Name = name,
                Fingerprint = fingerprint,
                Tags = tags.ToDictionary(t => t.Item1, t => t.Item2),
            };

        private static Dictionary<string, ObjectSnapshot> Document(params ObjectSnapshot[] objects) =>
            objects.ToDictionary(o => o.Id);

        [Fact]
        public void FindsWhatWasAddedChangedAndDeleted()
        {
            var before = Document(Snapshot("keep"), Snapshot("move", "1"), Snapshot("gone"));
            var after = Document(Snapshot("keep"), Snapshot("move", "2"), Snapshot("new"));
            var changes = RunDiff.Compare(before, after);
            Assert.Equal(new[] { "new" }, changes.Added.Select(c => c.Id));
            Assert.Equal(new[] { "move" }, changes.Changed.Select(c => c.Id));
            Assert.Equal(new[] { "gone" }, changes.Deleted.Select(c => c.Id));
            Assert.False(changes.Truncated);
        }

        [Fact]
        public void AnUnchangedDocumentHasNoChanges()
        {
            var changes = RunDiff.Compare(Document(Snapshot("a"), Snapshot("b")), Document(Snapshot("a"), Snapshot("b")));
            Assert.Empty(changes.Added);
            Assert.Empty(changes.Changed);
            Assert.Empty(changes.Deleted);
        }

        [Fact]
        public void ARenamedOrRetaggedObjectCountsAsChanged()
        {
            var before = Document(Snapshot("a", "1", "Old"), Snapshot("b", "1", "Same", ("hai.part", "dome")));
            var after = Document(Snapshot("a", "1", "New"), Snapshot("b", "1", "Same", ("hai.part", "hall")));
            var changes = RunDiff.Compare(before, after);
            Assert.Equal(new[] { "a", "b" }, changes.Changed.Select(c => c.Id));
        }

        [Fact]
        public void ADeletedObjectIsListedAsItWas()
        {
            var before = Document(Snapshot("gone", "1", "Wall", ("hai.part", "hall")));
            var changes = RunDiff.Compare(before, Document());
            var deleted = Assert.Single(changes.Deleted);
            Assert.Equal("Wall", deleted.Name);
            Assert.Equal("hall", deleted.Tags["hai.part"]);
        }

        [Fact]
        public void MoreChangesThanTheLimitAreCutAndSaidSo()
        {
            var after = Document(Enumerable.Range(0, 7).Select(i => Snapshot("n-" + i)).ToArray());
            var changes = RunDiff.Compare(Document(), after, 5);
            Assert.Equal(5, changes.Added.Count);
            Assert.True(changes.Truncated);
        }

        [Fact]
        public void ALongNameIsClippedToWhatTheBridgeAccepts()
        {
            var changes = RunDiff.Compare(Document(), Document(Snapshot("a", "1", new string('x', 500))));
            Assert.True(changes.Added[0].Name.Length <= Limits.ObjectName);
        }
    }

    public class OwnerStampTests
    {
        [Fact]
        public void PutsTheAgentAndThePartOnAnObjectAndKeepsItsOtherTags()
        {
            var stamped = OwnerStamp.Apply(new Dictionary<string, string> { ["mood"] = "calm" }, "architect", "dome");
            Assert.Equal("architect", stamped["hai.owner"]);
            Assert.Equal("dome", stamped["hai.part"]);
            Assert.Equal("calm", stamped["mood"]);
        }

        [Fact]
        public void WithoutAPartOnlyTheOwnerIsSet()
        {
            var stamped = OwnerStamp.Apply(new Dictionary<string, string>(), "architect", null);
            Assert.Equal(new[] { "hai.owner" }, stamped.Keys);
        }

        [Fact]
        public void ReplacesAnEarlierOwner()
        {
            var stamped = OwnerStamp.Apply(new Dictionary<string, string> { ["hai.owner"] = "product" }, "architect", null);
            Assert.Equal("architect", stamped["hai.owner"]);
        }

        [Fact]
        public void AFullObjectKeepsTheStampAndLosesAnotherTag()
        {
            var tags = Enumerable.Range(0, Limits.TagsPerObject).ToDictionary(i => "t" + i, i => "v");
            var stamped = OwnerStamp.Apply(tags, "architect", "dome");
            Assert.True(stamped.Count <= Limits.TagsPerObject);
            Assert.Equal("architect", stamped["hai.owner"]);
            Assert.Equal("dome", stamped["hai.part"]);
        }
    }
}
