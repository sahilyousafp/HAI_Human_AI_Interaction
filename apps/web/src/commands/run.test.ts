import { type Element, Element as ElementSchema, type SceneDocument, type SceneOp } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { Visibility } from "../viewer/visibility.ts";
import { type CommandHost, runCommand } from "./run.ts";

const make = (value: Record<string, unknown>): Element => ElementSchema.parse({ properties: {}, ...value });
const block = make({
  id: "block",
  name: "Block",
  type: "massing",
  origin: [0, 0, 0],
  size: [4000, 2000, 3000],
});
const wall = make({
  id: "wall",
  name: "Wall",
  type: "wall",
  start: [0, 0],
  end: [4000, 0],
  height: 3000,
  thickness: 200,
});
const doc = {
  version: 1,
  units: "mm",
  levels: [],
  elements: { block, wall },
} as unknown as SceneDocument;

function host(applied = true) {
  const calls = {
    applied: [] as Array<{ label: string; ops: SceneOp[] }>,
    selected: [] as string[][],
    flashed: [] as string[],
    asked: [] as Array<{ question: string; answer: (yes: boolean) => void }>,
  };
  const visibility = new Visibility();
  const value: CommandHost = {
    doc: () => doc,
    apply: (label, ops) => {
      calls.applied.push({ label, ops });
      return applied;
    },
    select: (ids) => calls.selected.push(ids),
    ask: (question, answer) => calls.asked.push({ question, answer }),
    flash: (message) => calls.flashed.push(message),
    visibility,
  };
  return { host: value, calls, visibility };
}

describe("running a command", () => {
  it("is not a command, so null, when the grammar does not understand all of it", () => {
    const { host: h, calls } = host();
    expect(runCommand("make it taller", h, ["block"])).toBeNull();
    expect(calls.applied).toEqual([]);
  });

  it("applies a chain as one change, labelled with what was said, and selects the copies", () => {
    const { host: h, calls } = host();
    expect(runCommand("copy and rotate 90", h, ["block"])).toEqual({ label: "Copy, rotate 90°" });
    expect(calls.applied).toHaveLength(1);
    expect(calls.applied[0]?.label).toBe("Copy, rotate 90°");
    expect(calls.selected).toHaveLength(1);
    expect(calls.selected[0]).toHaveLength(1);
  });

  it("with nothing to act on, says so and changes nothing", () => {
    const { host: h, calls } = host();
    expect(runCommand("rotate 90", h, [])).toEqual({ label: "Select something first." });
    expect(calls.flashed).toEqual(["Select something first."]);
    expect(calls.applied).toEqual([]);
  });

  it("says when the bridge could not take the change, and does not move the selection", () => {
    const { host: h, calls } = host(false);
    expect(runCommand("copy 3 m x", h, ["block"])).toEqual({ label: "The change could not be made." });
    expect(calls.selected).toEqual([]);
    expect(calls.flashed).toEqual(["The change could not be made."]);
  });
});

describe("delete", () => {
  it("asks first, and deletes only on a yes", () => {
    const { host: h, calls } = host();
    runCommand("delete this", h, ["wall"]);
    expect(calls.applied).toEqual([]);
    expect(calls.asked[0]?.question).toMatch(/^Delete Wall\? Nod or press Enter/);
    calls.asked[0]?.answer(false);
    expect(calls.applied).toEqual([]);
    calls.asked[0]?.answer(true);
    expect(calls.applied[0]).toEqual({ label: "Delete Wall", ops: [{ op: "delete", id: "wall" }] });
  });
});

describe("hide, isolate and show all", () => {
  it("take elements out of the view and bring them back, without touching the model", () => {
    const { host: h, calls, visibility } = host();
    runCommand("hide", h, ["wall"]);
    expect([...visibility.getSnapshot()]).toEqual(["wall"]);
    runCommand("isolate", h, ["wall"]);
    expect([...visibility.getSnapshot()]).toEqual(["block"]);
    runCommand("show all", h, []);
    expect(visibility.getSnapshot().size).toBe(0);
    expect(calls.applied).toEqual([]);
  });
});

describe("select", () => {
  it("selects by type and says how many", () => {
    const { host: h, calls } = host();
    expect(runCommand("select all walls", h, [])).toEqual({ label: "Select all walls" });
    expect(calls.selected).toEqual([["wall"]]);
    expect(calls.flashed).toEqual(["Selected 1."]);
  });
});
