using System;
using System.Collections.Generic;
using HAI.Rhino.Core.Protocol;

namespace HAI.Rhino.Core.Describe
{
    /// <summary>
    /// A component's own properties (every user string, not only the "hai." ones) as the bridge accepts them: at most 100,
    /// keys at most 120 characters and values at most 200. Empty keys are left out; a key seen twice keeps its first value.
    /// </summary>
    public static class ComponentProperties
    {
        public static Dictionary<string, string> From(IEnumerable<KeyValuePair<string?, string?>> strings)
        {
            var properties = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var pair in strings)
            {
                if (properties.Count >= Limits.PropertiesPerComponent) break;
                var key = pair.Key?.Trim();
                if (string.IsNullOrEmpty(key)) continue;
                key = Limits.Clip(key!, Limits.PropertyKey);
                if (properties.ContainsKey(key)) continue;
                properties[key] = Limits.Clip(pair.Value ?? "", Limits.PropertyValue);
            }

            return properties;
        }

        /// <summary>
        /// Whether working out an object's area and volume is quick enough to do while the user waits: the budget is about
        /// 10 ms an object, so a Brep of many faces or a heavy mesh is described without them.
        /// </summary>
        public static bool QuickToMeasure(int faces, bool isMesh) => isMesh ? faces <= 200_000 : faces <= 200;
    }
}
