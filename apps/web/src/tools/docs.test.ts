import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ACTION_LAYOUT, DEFAULT_REFERENCE_LAYOUT } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { registerBuiltinTools } from "./builtin.ts";
import { SLOT_NAMES } from "./palette.ts";
import { ToolRegistry } from "./registry.ts";

const doc = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "docs", "tools.md"), "utf8");

/** Rows of the Tools table: | Tool | Key | Default slot | What it does | */
const rows = [...doc.matchAll(/^\| ([A-Z][a-z ]+) \| ([A-Z]) \| ([^|]+) \|/gm)].map((m) => ({
  label: m[1]?.trim() ?? "",
  key: m[2] ?? "",
  slot: m[3]?.trim() ?? "",
}));

describe("docs/tools.md", () => {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);

  it("lists every built-in tool, with the shortcut the registry gives it", () => {
    const documented = Object.fromEntries(rows.map((r) => [r.label, r.key.toLowerCase()]));
    const actual = Object.fromEntries(registry.list().map((t) => [t.label, t.shortcut]));
    expect(documented).toEqual(actual);
  });

  it("gives each tool the slots it has in the two rings' default layouts", () => {
    for (const row of rows) {
      const id = registry.list().find((t) => t.label === row.label)?.id ?? "";
      const slots = [
        [DEFAULT_ACTION_LAYOUT, "action"],
        [DEFAULT_REFERENCE_LAYOUT, "reference"],
      ] as const;
      const where = slots
        .filter(([layout]) => layout.includes(id))
        .map(([layout, ring]) => `${SLOT_NAMES[layout.indexOf(id)]} (${ring})`);
      expect(row.slot).toBe(where.length > 0 ? where.join(", ") : "(not in a ring)");
    }
  });
});
