using System;
using System.Collections.Generic;
using System.Linq;
using HAI.Rhino.Core.Protocol;

namespace HAI.Rhino.Core.Changes
{
    /// <summary>
    /// What the plugin knows of one object at one moment, for comparing the document before and after a script. The
    /// fingerprint is anything that differs when the object was changed: the plugin uses the object's run-time serial
    /// number (a replaced or transformed object gets a new one) with its box.
    /// </summary>
    public sealed class ObjectSnapshot
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string Fingerprint { get; set; } = "";
        public Dictionary<string, string> Tags { get; set; } = new Dictionary<string, string>();
        public Bounds? Bounds { get; set; }
    }

    /// <summary>
    /// Finds what a script did to the document by comparing every object before and after it ran. A script is not
    /// sandboxed, so this does not prevent anything; it lets the bridge compare the result with the task's claim.
    /// </summary>
    public static class RunDiff
    {
        public static RunChanges Compare(
            IReadOnlyDictionary<string, ObjectSnapshot> before,
            IReadOnlyDictionary<string, ObjectSnapshot> after,
            int limit = Limits.ObjectsPerBatch)
        {
            var added = new List<ObjectSnapshot>();
            var changed = new List<ObjectSnapshot>();
            var deleted = new List<ObjectSnapshot>();
            foreach (var pair in after)
            {
                if (!before.TryGetValue(pair.Key, out var old)) added.Add(pair.Value);
                else if (Differs(old, pair.Value)) changed.Add(pair.Value);
            }

            foreach (var pair in before)
            {
                if (!after.ContainsKey(pair.Key)) deleted.Add(pair.Value);
            }

            return new RunChanges
            {
                Added = Listed(added, limit),
                Changed = Listed(changed, limit),
                Deleted = Listed(deleted, limit),
                Truncated = added.Count > limit || changed.Count > limit || deleted.Count > limit,
            };
        }

        private static bool Differs(ObjectSnapshot old, ObjectSnapshot now) =>
            old.Fingerprint != now.Fingerprint
            || old.Name != now.Name
            || old.Tags.Count != now.Tags.Count
            || old.Tags.Any(t => !now.Tags.TryGetValue(t.Key, out var value) || value != t.Value);

        private static List<ObjectChange> Listed(List<ObjectSnapshot> objects, int limit) =>
            objects
                .OrderBy(o => o.Id, StringComparer.Ordinal)
                .Take(limit)
                .Select(o => new ObjectChange
                {
                    Id = o.Id,
                    Name = Limits.Clip(o.Name, Limits.ObjectName),
                    Tags = o.Tags,
                    Bounds = o.Bounds,
                })
                .ToList();
    }

    /// <summary>The tags that say who made an object and which part it belongs to.</summary>
    public static class OwnerStamp
    {
        public const string Owner = "hai.owner";
        public const string Part = "hai.part";

        /// <summary>
        /// The object's tags with the agent's name (and the task's part, when it has one) put on them. Other tags stay;
        /// values are kept within the limits the bridge enforces, and so are the number of tags: when an object is full
        /// the stamp wins over the oldest other tag.
        /// </summary>
        public static Dictionary<string, string> Apply(IReadOnlyDictionary<string, string> tags, string agent, string? part)
        {
            var stamped = new Dictionary<string, string>();
            foreach (var tag in tags) stamped[tag.Key] = tag.Value;
            stamped[Owner] = Limits.Clip(agent, Limits.TagValue);
            if (!string.IsNullOrEmpty(part)) stamped[Part] = Limits.Clip(part!, Limits.TagValue);
            foreach (var extra in stamped.Keys.Where(k => k != Owner && k != Part).ToList())
            {
                if (stamped.Count <= Limits.TagsPerObject) break;
                stamped.Remove(extra);
            }

            return stamped;
        }
    }
}
