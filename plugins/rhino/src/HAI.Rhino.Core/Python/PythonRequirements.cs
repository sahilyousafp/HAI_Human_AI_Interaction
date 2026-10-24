using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace HAI.Rhino.Core.Python
{
    /// <summary>The packages a script names on its "# r: package" lines, and the specs that are not packages.</summary>
    public sealed class Requirements
    {
        public IReadOnlyList<string> Packages { get; }
        public IReadOnlyList<string> Invalid { get; }

        public Requirements(IReadOnlyList<string> packages, IReadOnlyList<string> invalid)
        {
            Packages = packages;
            Invalid = invalid;
        }
    }

    /// <summary>
    /// Reads the requirement lines of a script the way the bridge does (apps/bridge/src/mcp/rhino-tools.ts), so the
    /// approval card lists exactly what Rhino would install: <c># r: ladybug-core, numpy==2.1</c>.
    /// </summary>
    public static class PythonRequirements
    {
        // A package as pip is given it: a name and, if wished, one version rule. Nothing that starts with a dash (an
        // option such as --index-url), no URLs, paths or spaces: the packages come from an agent and the user approves
        // exactly what is listed.
        private static readonly Regex Package = new Regex(
            @"^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?((==|>=|<=|~=|!=|>|<)[A-Za-z0-9.*+!_-]+)?$",
            RegexOptions.CultureInvariant);

        private static readonly Regex Line = new Regex(@"^\s*#\s*r:\s*(.+?)\s*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        public static bool IsPackageSpec(string spec) => spec.Length <= 100 && Package.IsMatch(spec);

        public static Requirements Parse(string code)
        {
            var packages = new List<string>();
            var invalid = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var line in code.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None))
            {
                var match = Line.Match(line);
                if (!match.Success) continue;
                foreach (var part in match.Groups[1].Value.Split(','))
                {
                    var spec = part.Trim();
                    if (spec.Length == 0) continue;
                    if (!IsPackageSpec(spec)) invalid.Add(spec);
                    else if (seen.Add(spec)) packages.Add(spec);
                }
            }

            return new Requirements(packages, invalid);
        }
    }
}
