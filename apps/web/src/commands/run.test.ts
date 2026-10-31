import {
  type Element,
  Element as ElementSchema,
  type LetterMarker,
  type SceneDocument,
  type SceneOp,
} from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { Visibility } from "../viewer/visibility.ts";
import { type CommandHost, CommandMemory, reviseCommand, runCommand } from "./run.ts";

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

function host(applied = true, markers: LetterMarker[] = []) {
  const calls = {
    applied: [] as Array<{ label: string; ops: SceneOp[] }>,
    selected: [] as string[][],
    flashed: [] as string[],
    asked: [] as Array<{ question: string; answer: (yes: boolean) => void }>,
    undone: 0,
    /** The scene's sequence number: every change, undo included, moves it on by one. */
    seq: 10,
  };
  const visibility = new Visibility();
  const value: CommandHost = {
    doc: () => doc,
    apply: (label, ops) => {
      calls.applied.push({ label, ops });
      calls.seq += 1;
      return applied;
    },
    seq: () => calls.seq,
    undo: () => {
      calls.undone += 1;
      calls.seq += 1;
      return true;
    },
    select: (ids) => calls.selected.push(ids),
    ask: (question, answer) => calls.asked.push({ question, answer }),
    flash: (message) => calls.flashed.push(message),
    markers: () => markers,
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

describe("correcting the last command", () => {
  const ran = (text: string, calls: ReturnType<typeof host>, memory: CommandMemory, ids = ["block"]) =>
    runCommand(text, calls.host, ids, memory);
  const lastApplied = (h: ReturnType<typeof host>) => h.calls.applied.at(-1);
  const originX = (h: ReturnType<typeof host>) => {
    const op = lastApplied(h)?.ops[0];
    return op && op.op === "update" ? (op.patch as { origin?: number[] }).origin?.[0] : undefined;
  };

  it("make it 4 m takes the move back and makes it again with 4 m, in the direction it had", () => {
    const h = host();
    const memory = new CommandMemory();
    ran("move 5 m east", h, memory);
    expect(originX(h)).toBe(5000);
    const run = reviseCommand("make it 4 m", h.host, memory);
    expect(run).not.toBeNull();
    expect(h.calls.undone).toBe(1);
    expect(originX(h)).toBe(4000);
    expect(h.calls.applied).toHaveLength(2);
  });

  it("can be corrected again, and again counts from the new one", () => {
    const h = host();
    const memory = new CommandMemory();
    ran("move 5 m east", h, memory);
    reviseCommand("change it to 4 metres", h.host, memory);
    reviseCommand("no, 3 meters", h.host, memory);
    expect(h.calls.undone).toBe(2);
    expect(originX(h)).toBe(3000);
  });

  it("changes an array's count, a rotation's angle and a scale's factor", () => {
    const h = host();
    const memory = new CommandMemory();
    ran("copy 5 times 6 m along y", h, memory);
    reviseCommand("make it 3 times", h.host, memory);
    expect(lastApplied(h)?.ops.filter((op) => op.op === "create")).toHaveLength(3);
    ran("rotate 90", h, memory);
    reviseCommand("actually 45 degrees", h.host, memory);
    expect(JSON.stringify(lastApplied(h)?.ops)).toContain('"rotationDeg":45');
    ran("scale 2", h, memory);
    reviseCommand("make it 3", h.host, memory); // a bare number is a scale's factor
    expect(JSON.stringify(lastApplied(h)?.ops)).toContain("12000");
  });

  it("a bare number for an array is its count, and for a move it is metres when the old one was whole metres", () => {
    const h = host();
    const memory = new CommandMemory();
    ran("array 5 times", h, memory);
    reviseCommand("make it 2", h.host, memory);
    expect(lastApplied(h)?.ops.filter((op) => op.op === "create")).toHaveLength(2);
    ran("move 5 m east", h, memory);
    reviseCommand("make it 4", h.host, memory);
    expect(originX(h)).toBe(4000);
  });

  it("is not a correction when something else changed the model since, or a long time passed, or nothing came before", () => {
    const h = host();
    const memory = new CommandMemory();
    expect(reviseCommand("make it 4 m", h.host, memory)).toBeNull(); // nothing before
    ran("move 5 m east", h, memory);
    h.calls.seq += 1; // someone moved something by hand
    expect(reviseCommand("make it 4 m", h.host, memory)).toBeNull();
    const again = host();
    const later = new CommandMemory();
    ran("move 5 m east", again, later);
    expect(reviseCommand("make it 4 m", again.host, later, Date.now() + 10 * 60_000)).toBeNull();
    expect(again.calls.undone).toBe(0);
  });

  it("what is not only a number is not a correction: make this 300 thick is the agent's", () => {
    const h = host();
    const memory = new CommandMemory();
    ran("move 5 m east", h, memory);
    for (const said of [
      "make this 300 thick",
      "make this wall three hundred thick",
      "make it taller",
      "4 m",
      "move 4 m",
    ])
      expect(reviseCommand(said, h.host, memory), said).toBeNull();
    expect(h.calls.undone).toBe(0);
  });

  it("says what cannot be changed instead of undoing anything: an angle for a move", () => {
    const h = host();
    const memory = new CommandMemory();
    ran("move 5 m east", h, memory);
    const run = reviseCommand("make it 45 degrees", h.host, memory);
    expect(run?.label).toMatch(/no angle/i);
    expect(h.calls.undone).toBe(0);
  });
});
