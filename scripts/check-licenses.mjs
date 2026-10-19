// Fails when a production dependency is GPL, AGPL, non-commercial or has no recognisable license.
// Exceptions go in scripts/license-allowlist.json as { "package-name": "reason" }.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findViolations } from "./licenses.mjs";

const allowlist = JSON.parse(readFileSync(new URL("./license-allowlist.json", import.meta.url), "utf8"));

// Run pnpm's own JS entry with this Node binary: no shell, so no quoting or DEP0190 issues on Windows.
const pnpmEntry = process.env.npm_execpath;
const [command, prefix] =
  pnpmEntry && /\.[cm]?js$/.test(pnpmEntry) ? [process.execPath, [pnpmEntry]] : ["pnpm", []];

let raw;
try {
  raw = execFileSync(command, [...prefix, "licenses", "list", "--prod", "--json", "-r"], {
    encoding: "utf8",
  });
} catch (error) {
  console.error("Could not run `pnpm licenses list`:", error.message);
  process.exit(2);
}

// pnpm prints a plain sentence instead of JSON when there are no production dependencies.
const report = raw.trim().startsWith("{") ? JSON.parse(raw) : {};
const violations = findViolations(report, allowlist);

if (violations.length > 0) {
  console.error("License policy violations (production dependencies):");
  for (const v of violations) {
    console.error(`  ${v.name}@${v.versions.join(",")}  ${v.license}  (${v.verdict})`);
  }
  console.error("Remove the dependency, or add it to scripts/license-allowlist.json with a reason.");
  process.exit(1);
}

const count = Object.values(report).reduce((n, pkgs) => n + pkgs.length, 0);
console.log(`License check passed: ${count} production packages, no GPL, AGPL or non-commercial licenses.`);
