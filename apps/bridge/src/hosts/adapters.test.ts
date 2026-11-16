import { HOST_IDS } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { HOST_ADAPTERS, requirementPackages } from "./adapters.ts";

describe("requirement lines", () => {
  it("a package is listed for approval: packages are read from '# r:' lines, once each, and what is not a package is reported", () => {
    expect(
      requirementPackages(
        "# r: ladybug-core, numpy==2.1\nimport x\n  # R: ladybug-core\n# r: --index-url=https://x\nprint()",
      ),
    ).toEqual({ packages: ["ladybug-core", "numpy==2.1"], invalid: ["--index-url=https://x"] });
    expect(requirementPackages("print('# r: not a line')").packages).toEqual([]);
  });
});

describe("the adapters", () => {
  it("every host has one, with its name, its strengths, how to connect it and its language", () => {
    for (const id of HOST_IDS) {
      const adapter = HOST_ADAPTERS[id];
      expect(adapter.id).toBe(id);
      expect(adapter.strengths.length).toBeGreaterThan(20);
      expect(adapter.connectHint).toMatch(/\.$/);
    }
    expect(HOST_ADAPTERS.revit.language).toBe("csharp");
    expect(HOST_ADAPTERS.rhino.language).toBe("python");
  });

  it("only Rhino reads packages from its script: Blender and Revit install nothing for a run", () => {
    const code = "# r: numpy\nprint(1)";
    expect(HOST_ADAPTERS.rhino.packagesOf(code).packages).toEqual(["numpy"]);
    expect(HOST_ADAPTERS.blender.packagesOf(code).packages).toEqual([]);
    expect(HOST_ADAPTERS.revit.packagesOf(code).packages).toEqual([]);
  });
});
