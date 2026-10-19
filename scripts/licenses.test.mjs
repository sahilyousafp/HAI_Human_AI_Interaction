import { describe, expect, it } from "vitest";
import { classifyExpression, findViolations } from "./licenses.mjs";

describe("classifyExpression", () => {
  it.each([
    ["MIT", "allowed"],
    ["Apache-2.0", "allowed"],
    ["LGPL-2.1", "allowed"],
    ["MPL-2.0", "allowed"],
    ["GPL-3.0", "forbidden"],
    ["GPL-2.0-or-later", "forbidden"],
    ["AGPL-3.0-only", "forbidden"],
    ["CC-BY-NC-4.0", "forbidden"],
    ["CC-BY-NC-SA-4.0", "forbidden"],
    ["(MIT OR GPL-3.0)", "allowed"],
    ["MIT AND GPL-3.0", "forbidden"],
    ["UNKNOWN", "unknown"],
    ["", "unknown"],
  ])("%s is %s", (expr, expected) => {
    expect(classifyExpression(expr)).toBe(expected);
  });
});

describe("findViolations", () => {
  const report = {
    MIT: [{ name: "ok-pkg", versions: ["1.0.0"] }],
    "GPL-2.0-or-later": [{ name: "gpl-pkg", versions: ["7.0.0"] }],
  };

  it("reports forbidden packages", () => {
    expect(findViolations(report).map((v) => v.name)).toEqual(["gpl-pkg"]);
  });

  it("skips allow-listed packages", () => {
    expect(findViolations(report, { "gpl-pkg": "build-time only" })).toEqual([]);
  });
});
