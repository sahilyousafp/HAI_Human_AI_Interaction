import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerBuiltinTools } from "../tools/builtin.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { heardAs } from "../voice/heard.ts";
import { parseCommand, parseCorrection } from "./grammar.ts";

// The ways people say the offline commands (test-assets/commands/phrases.json, built by scripts/make-command-phrases.mjs):
// each must read as its plain wording, a mishearing must be put right first, and what is the agent's must not be guessed.

interface Entry {
  group: string;
  kind: "offline" | "agent" | "correction" | "not-correction";
  expect?: unknown;
  text: string;
  plain?: string;
  corrected?: boolean;
  skip?: string;
}
const file = join(import.meta.dirname, "..", "..", "..", "..", "test-assets", "commands", "phrases.json");
const { entries } = JSON.parse(readFileSync(file, "utf8")) as { entries: Entry[] };
const registry = new ToolRegistry();
registerBuiltinTools(registry);
const tools = registry.list();

describe("the phrase set", () => {
  const offline = entries.filter((e) => e.kind === "offline" && !e.corrected && !e.skip);
  const corrections = entries.filter((e) => e.kind === "correction");
  const notCorrections = entries.filter((e) => e.kind === "not-correction");
  const agent = entries.filter((e) => e.kind === "agent");
  const misheard = entries.filter((e) => e.corrected);

  it("has a good spread: hundreds of ways to say the offline commands, and phrases that are the agent's", () => {
    expect(offline.length).toBeGreaterThan(300);
    expect(agent.length).toBeGreaterThan(40);
    expect(new Set(offline.map((e) => e.group))).toEqual(
      new Set(["move", "copy", "array", "rotate", "scale", "mirror", "select", "marker", "chain"]),
    );
  });

  it("every way of saying an offline command reads as its plain wording", () => {
    const wrong = offline.flatMap((e) => {
      const said = parseCommand(e.text);
      const plain = parseCommand(e.plain ?? "");
      if (plain === null) return [`${e.text} (the plain wording "${e.plain}" is not a command itself)`];
      return JSON.stringify(said) === JSON.stringify(plain) ? [] : [`${e.text} -> ${e.plain}`];
    });
    expect(wrong).toEqual([]);
  });

  it("a mishearing is put right to the plain wording", () => {
    const wrong = misheard.flatMap((e) => {
      const fixed = parseCommand(e.text) ? e.text : heardAs(e.text, tools);
      const plain = parseCommand(e.plain ?? "");
      return fixed !== null && JSON.stringify(parseCommand(fixed)) === JSON.stringify(plain)
        ? []
        : [`${e.text} -> ${e.plain}`];
    });
    expect(wrong).toEqual([]);
  });

  it("what is the agent's is never guessed into a command, with or without putting a mishearing right", () => {
    const guessed = agent.filter((e) => {
      const fixed = heardAs(e.text, tools);
      return parseCommand(e.text) !== null || (fixed !== null && parseCommand(fixed) !== null);
    });
    expect(guessed.map((e) => e.text)).toEqual([]);
  });

  it("a correction is read as the number it means, however it is said", () => {
    const wrong = corrections.flatMap((e) => {
      const said = parseCorrection(e.text);
      return JSON.stringify(said) === JSON.stringify(e.expect)
        ? []
        : [`${e.text} -> ${JSON.stringify(said)}`];
    });
    expect(corrections.length).toBeGreaterThan(30);
    expect(wrong).toEqual([]);
  });

  it("what only sounds like a correction (it names something, or is a new request) is not one", () => {
    expect(notCorrections.filter((e) => parseCorrection(e.text) !== null).map((e) => e.text)).toEqual([]);
  });
});
