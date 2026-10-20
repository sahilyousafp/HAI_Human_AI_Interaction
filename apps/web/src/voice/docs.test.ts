import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VOICE } from "./voice-config.ts";

const doc = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "docs", "voice.md"), "utf8");

describe("docs/voice.md", () => {
  const documented = new Map(
    [...doc.matchAll(/^\| `([a-zA-Z]+)` \| ([0-9.]+) \|/gm)].map((m) => [m[1] ?? "", Number(m[2])]),
  );

  it.each(Object.entries(VOICE))("documents %s with its current value", (key, value) => {
    expect(documented.get(key)).toBe(value);
  });

  it("documents nothing that is not in the config", () => {
    expect([...documented.keys()].filter((key) => !(key in VOICE))).toEqual([]);
  });
});
