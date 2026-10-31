import { phonemize } from "phonemize";
import { describe, expect, it } from "vitest";
import { COMMAND_VOCABULARY, parseCommand, wordsOf } from "../commands/grammar.ts";
import { registerBuiltinTools } from "../tools/builtin.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { heardAs } from "./heard.ts";
import { Lexicon, NEAR, soundDistance } from "./lexicon.ts";
import { toolNamed } from "./tool-commands.ts";

const registry = new ToolRegistry();
registerBuiltinTools(registry);
const tools = registry.list();
const toolWords = tools.flatMap((tool) =>
  (tool.spoken ?? [tool.label.toLowerCase()]).flatMap((n) => n.split(" ")),
);
const lexicon = new Lexicon([...COMMAND_VOCABULARY, ...toolWords], phonemize);
const distance = (a: string, b: string) => soundDistance(phonemize(a), phonemize(b));

/** What the app would do with a transcript: the tool it names, or the command it is. */
const understood = (text: string) => toolNamed(text, tools) !== null || parseCommand(text) !== null;
const fixed = (text: string) => lexicon.correct(wordsOf(text), understood);

describe("how alike two words sound", () => {
  it("homophones are the same sound, however they are spelled", () => {
    for (const [a, b] of [
      ["to", "two"],
      ["for", "four"],
      ["ate", "eight"],
      ["undue", "undo"],
      ["laso", "lasso"],
    ] as const)
      expect(distance(a, b)).toBe(0);
  });

  it("the mishearings measured with the speech models are within reach of the word they were", () => {
    for (const [heard, meant] of [
      ["colon", "column"],
      ["kalam", "column"],
      ["scatch", "sketch"],
      ["slap", "slab"],
      ["won", "one"],
      ["redu", "redo"],
    ] as const)
      expect(distance(heard, meant), `${heard} for ${meant}`).toBeLessThanOrEqual(NEAR);
  });

  it("words that are different words are not within reach", () => {
    for (const [a, b] of [
      ["move", "mirror"],
      ["wall", "slab"],
      ["copy", "column"],
      ["rotate", "scale"],
      ["hide", "select"],
      ["east", "west"],
      ["three", "six"],
    ] as const)
      expect(distance(a, b), `${a} and ${b}`).toBeGreaterThan(NEAR);
  });
});

describe("putting a transcript right with the app's word sets", () => {
  it("a number heard as the word that sounds like it is put right where it makes a command", () => {
    expect(fixed("copy for times six metres along y")).toBe("copy four times six metres along y");
    expect(fixed("scale to")).toBe("scale two");
    expect(fixed("rotate ate degrees")).toBe("rotate eight degrees");
    expect(fixed("move won metre east")).toBe("move one metre east");
  });

  it("a tool name heard as a word that sounds like it is put right", () => {
    expect(fixed("colon")).toBe("column");
    expect(fixed("slap")).toBe("slab");
    expect(fixed("use the colon tool")).toBe("use the column tool");
  });

  it("a command word heard as a word that sounds like it is put right", () => {
    expect(fixed("mirror ex")).toBe("mirror x");
    expect(fixed("rotate ninety degrees clockwize")).toBe("rotate ninety degrees clockwise");
  });

  it("what is already understood, or not understood either way, is left alone", () => {
    expect(fixed("copy and rotate 90")).toBeNull(); // nothing to put right: it is a command already
    expect(fixed("add three floors to this block")).toBeNull(); // a request for the agent
    expect(fixed("make this wall three hundred thick")).toBeNull();
    expect(fixed("write a colon after the title")).toBeNull();
  });

  it("a change is only made when it makes the transcript something the app understands in full", () => {
    expect(fixed("copy for the wall")).toBeNull(); // "four" would not make it a command
    expect(fixed("hello there")).toBeNull();
  });
});

describe("the transcript the app acts on", () => {
  it("is put right, tools and spoken words included", () => {
    expect(heardAs("colon", tools)).toBe("column");
    expect(heardAs("scale to", tools)).toBe("scale two");
    expect(heardAs("copy and rotate 90", tools)).toBeNull();
  });
});
