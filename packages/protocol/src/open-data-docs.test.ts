import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPEN_DATA_SOURCES, STARTER_PORTALS } from "./open-data.ts";

const doc = readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "open-data.md"), "utf8");

describe("docs/open-data.md", () => {
  it.each(OPEN_DATA_SOURCES.map((s) => [s.id, s] as const))(
    "lists %s with its name, every host and its licence",
    (_id, source) => {
      const row = doc.split("\n").find((line) => line.startsWith(`| ${source.name} |`));
      expect(row, `a table row for ${source.name}`).toBeDefined();
      for (const host of source.hosts) expect(row).toContain(`\`${host}\``);
      expect(row).toContain(source.licence);
    },
  );

  it("names the starter portals", () => {
    for (const { host } of STARTER_PORTALS) expect(doc, host).toContain(host);
  });

  it("says where the Ladybug licence boundary is", () => {
    expect(doc).toContain("GPL-3.0");
    expect(doc).toContain("separate program");
  });

  it("never uses an em dash", () => {
    expect(doc).not.toContain("—");
  });
});
