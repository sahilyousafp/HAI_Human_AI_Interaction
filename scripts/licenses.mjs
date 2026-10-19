// License policy for shipped (production) dependencies: no GPL, AGPL or non-commercial terms.
// LGPL and MPL are allowed (weak, file-level copyleft that does not spread to this project).

const FORBIDDEN = [/^AGPL/i, /^GPL/i, /-NC(-|$)/i, /NonCommercial/i, /^SSPL/i, /^BUSL/i, /^Elastic/i];
const UNKNOWN = [/^UNKNOWN$/i, /^UNLICENSED$/i, /^SEE LICENSE IN/i, /^$/];

/** Classify one SPDX id (no operators). */
export function classifyId(id) {
  const clean = id.trim().replace(/^\(|\)$/g, "");
  if (UNKNOWN.some((re) => re.test(clean))) return "unknown";
  if (/^LGPL/i.test(clean)) return "allowed";
  if (FORBIDDEN.some((re) => re.test(clean))) return "forbidden";
  return "allowed";
}

/**
 * Classify an SPDX expression. "A OR B" passes if any alternative passes;
 * "A AND B" passes only if every part passes.
 */
export function classifyExpression(expr) {
  const text = String(expr ?? "").trim();
  if (!text) return "unknown";
  const alternatives = text.split(/\s+OR\s+/i);
  const results = alternatives.map((alt) => {
    const parts = alt.split(/\s+AND\s+/i).map(classifyId);
    if (parts.includes("forbidden")) return "forbidden";
    if (parts.includes("unknown")) return "unknown";
    return "allowed";
  });
  if (results.includes("allowed")) return "allowed";
  if (results.includes("unknown")) return "unknown";
  return "forbidden";
}

/**
 * Check `pnpm licenses list --json` output ({ [license]: [{ name, versions }] }).
 * Returns the packages that violate policy, minus allow-listed exceptions.
 */
export function findViolations(report, allowlist = {}) {
  const violations = [];
  for (const [license, packages] of Object.entries(report)) {
    const verdict = classifyExpression(license);
    if (verdict === "allowed") continue;
    for (const pkg of packages) {
      if (allowlist[pkg.name]) continue;
      violations.push({ name: pkg.name, versions: pkg.versions ?? [], license, verdict });
    }
  }
  return violations;
}
