import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEAM } from "./team.ts";

const doc = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "docs", "agents.md"), "utf8");

describe("docs/agents.md", () => {
  const documented = new Map(
    [...doc.matchAll(/^\| `([a-zA-Z]+)` \| ([0-9.]+) \|/gm)].map((m) => [m[1] ?? "", Number(m[2])]),
  );

  it.each(Object.entries(TEAM))("documents %s with its current value", (key, value) => {
    expect(documented.get(key)).toBe(value);
  });

  it("documents nothing that is not in the team's limits", () => {
    expect([...documented.keys()].filter((key) => !(key in TEAM))).toEqual([]);
  });

  it("never uses an em dash", () => {
    expect(doc).not.toContain("—");
  });
});
