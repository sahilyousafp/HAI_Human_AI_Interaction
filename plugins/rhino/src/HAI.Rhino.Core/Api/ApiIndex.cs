using System;
using System.Collections.Generic;
using System.Linq;
using HAI.Rhino.Core.Protocol;

namespace HAI.Rhino.Core.Api
{
    /// <summary>
    /// The scripting API as a list of entries, searched by name. The plugin fills it by reflection inside the running Rhino,
    /// so an answer is exactly the version the user has; the matching itself needs no Rhino and is tested here.
    /// </summary>
    public sealed class ApiIndex
    {
        private readonly List<ApiEntry> entries = new List<ApiEntry>();
        private readonly object gate = new object();

        /// <summary>Whether every entry is in (lookups before then answer with what is indexed so far).</summary>
        public bool Complete { get; private set; }

        public void Add(IEnumerable<ApiEntry> more)
        {
            lock (gate) entries.AddRange(more);
        }

        public void Finish()
        {
            lock (gate) Complete = true;
        }

        public int Count
        {
            get
            {
                lock (gate) return entries.Count;
            }
        }

        /// <summary>
        /// The entries whose full name matches the query, best first: the member's own name exactly ("CreateFromLoft"), then
        /// a dotted tail of the full name ("Brep.CreateFromLoft"), then the name containing the query. Case is ignored.
        /// </summary>
        public ApiResult Find(string id, string query, int max = Limits.ApiEntries)
        {
            var q = (query ?? "").Trim();
            List<ApiEntry> snapshot;
            bool complete;
            lock (gate)
            {
                snapshot = entries.ToList();
                complete = Complete;
            }

            var matched = new List<(ApiEntry Entry, int Rank)>();
            if (q.Length > 0)
            {
                foreach (var entry in snapshot)
                {
                    var rank = Rank(entry.Name, q);
                    if (rank >= 0) matched.Add((entry, rank));
                }
            }

            var ordered = matched
                .OrderBy(m => m.Rank)
                .ThenBy(m => m.Entry.Name.Length)
                .ThenBy(m => m.Entry.Name, StringComparer.Ordinal)
                .Select(m => m.Entry)
                .ToList();
            return new ApiResult
            {
                Id = id,
                Entries = ordered.Take(max).ToList(),
                Truncated = ordered.Count > max,
                Partial = !complete,
            };
        }

        /// <summary>0 for the member's own name, 1 for a dotted tail of the full name, 2 for a name containing it; -1 for none.</summary>
        public static int Rank(string fullName, string query)
        {
            var dot = fullName.LastIndexOf('.');
            var own = dot >= 0 ? fullName.Substring(dot + 1) : fullName;
            if (string.Equals(own, query, StringComparison.OrdinalIgnoreCase)) return 0;
            if (fullName.EndsWith("." + query, StringComparison.OrdinalIgnoreCase)) return 1;
            if (fullName.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0) return 2;
            return -1;
        }

        /// <summary>An entry clipped to what the bridge accepts.</summary>
        public static ApiEntry Entry(string name, string kind, string signature, string? summary) =>
            new ApiEntry
            {
                Name = Limits.Clip(name, Limits.ApiName),
                Kind = kind,
                Signature = Limits.Clip(signature, Limits.ApiSignature),
                Summary = string.IsNullOrWhiteSpace(summary) ? null : Limits.Clip(summary!.Trim(), Limits.ApiSummary),
            };
    }
}
