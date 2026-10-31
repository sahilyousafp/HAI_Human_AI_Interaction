import { describe, expect, it } from "vitest";
import { registerBuiltinTools } from "../tools/builtin.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { toolNamed } from "./tool-commands.ts";
import { tokenLimit, wholeFrames } from "./voice-config.ts";

const registry = new ToolRegistry();
registerBuiltinTools(registry);
const named = (text: string) => toolNamed(text, registry.list())?.id ?? null;

describe("tool names by voice", () => {
  it("a transcript that is only a tool's spoken name picks it, whatever its case and punctuation", () => {
    expect(named("measure")).toBe("measure");
    expect(named("Measure.")).toBe("measure");
    expect(named("Wall!")).toBe("wall");
    expect(named("undo")).toBe("undo");
    expect(named("sketch area")).toBe("sketch-area");
    expect(named("Area")).toBe("sketch-area");
    expect(named("marker")).toBe("place-marker");
  });

  it("every built-in tool can be picked by each of its spoken names, and no name is shared", () => {
    const seen = new Map<string, string>();
    for (const tool of registry.list()) {
      for (const name of tool.spoken ?? [tool.label.toLowerCase()]) {
        expect(named(name), name).toBe(tool.id);
        expect(seen.get(name), `${name} is said for two tools`).toBeUndefined();
        seen.set(name, tool.id);
      }
    }
  });

  it('the words around a name do not matter: "use the wall tool"', () => {
    expect(named("use the wall tool")).toBe("wall");
    expect(named("tool measure")).toBe("measure");
    expect(named("section tool")).toBe("section");
  });

  it("Near miss within one letter: names of five letters or more allow one letter of difference", () => {
    expect(named("sketch aria")).toBe("sketch-area");
    expect(named("measur")).toBe("measure");
    expect(named("colum")).toBe("column");
    // Shorter names must be exact: "wal" is not Wall, "cot" is not Cut.
    expect(named("wal")).toBeNull();
    expect(named("cot")).toBeNull();
  });

  it("A longer request goes to the agent", () => {
    expect(named("measure the distance between these towers")).toBeNull();
    expect(named("move the stair")).toBeNull();
    expect(named("a wall along this")).toBeNull();
    expect(named("")).toBeNull();
  });

  it("Registered tool can be spoken: a tool registered later is picked by its own spoken name", () => {
    const more = new ToolRegistry();
    registerBuiltinTools(more);
    more.register({ id: "rhino-bake", label: "Bake to Rhino", icon: "", shortcut: "j", spoken: ["bake"] });
    expect(toolNamed("bake", more.list())?.id).toBe("rhino-bake");
    // Without spoken names, its label is what is said.
    more.register({ id: "drape", label: "Drape", icon: "", shortcut: "y" });
    expect(toolNamed("drape", more.list())?.id).toBe("drape");
  });
});

describe("transcribing short commands", () => {
  it("a one-word command under a second still gets enough tokens to be written in full", () => {
    expect(tokenLimit(15_000)).toBe(16); // 0.94 s: transformers.js alone would allow none
    expect(tokenLimit(48_000)).toBe(18); // 3 s: 6 a second, as before
    expect(tokenLimit(52_000)).toBe(20); // 3.25 s rounds up
  });

  it("the audio is padded with silence to whole 5 ms frames, as the v2 frontend needs, and not otherwise changed", () => {
    expect(wholeFrames(new Float32Array(160)).length).toBe(160);
    const odd = Float32Array.from({ length: 161 }, (_, i) => i + 1);
    const padded = wholeFrames(odd);
    expect(padded.length).toBe(240);
    expect([...padded.slice(0, 161)]).toEqual([...odd]);
    expect(padded.slice(161).every((sample) => sample === 0)).toBe(true);
  });

  it("the speech model's measured mishearings of tool names pick the tool", () => {
    expect(named("Undue.")).toBe("undo");
    expect(named("Scatch area")).toBe("sketch-area");
  });
});
