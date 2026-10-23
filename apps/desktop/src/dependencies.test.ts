import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The licence check reads production dependencies. The desktop app ships as bundles, so everything its own code
// imports from a package is shipped inside them and must be declared as a production dependency, or the check
// would not see it.
const root = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function importedPackages(dir: string): Set<string> {
  const found = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const name of importedPackages(path)) found.add(name);
    } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      // Only real import and export lines: `from "..."` at the end of a statement, not the same words in a comment.
      for (const match of readFileSync(path, "utf8").matchAll(
        /^(?:import|export)\b[^;]*?\bfrom "([^"]+)";/gms,
      )) {
        const specifier = match[1] as string;
        if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
        found.add(
          specifier.startsWith("@")
            ? specifier.split("/").slice(0, 2).join("/")
            : (specifier.split("/")[0] ?? specifier),
        );
      }
    }
  }
  return found;
}

describe("the desktop app's dependencies", () => {
  it("declares every package its shipped code imports as a production dependency, except Electron itself", () => {
    const imported = [...importedPackages(join(root, "src"))].filter((name) => name !== "electron");
    const missing = imported.filter((name) => !pkg.dependencies?.[name]);
    expect(missing).toEqual([]);
  });

  it("keeps build tools out of the production dependencies", () => {
    for (const tool of ["electron", "electron-builder", "esbuild"]) {
      expect(pkg.dependencies?.[tool]).toBeUndefined();
      expect(pkg.devDependencies?.[tool]).toBeDefined();
    }
  });
});
