import { type Element, Element as ElementSchema, type SceneDocument } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { parseCommand } from "./grammar.ts";
import {
  commandLabel,
  lengthText,
  type Plan,
  planCommand,
  planHostCommand,
  REMOVED_COMMAND,
} from "./plan.ts";

const common = { properties: {} };
const element = (value: Record<string, unknown>): Element => ElementSchema.parse({ ...common, ...value });

const block = element({
  id: "block",
  name: "Block",
  type: "massing",
  origin: [0, 0, 0],
  size: [4000, 2000, 3000],
});
const wallA = element({
  id: "wall-a",
  name: "Wall A",
  type: "wall",
  level: "L2",
  start: [0, 0],
  end: [4000, 0],
  height: 3000,
  thickness: 200,
});
const wallB = element({
  id: "wall-b",
  name: "Wall B",
  type: "wall",
  start: [0, 5000],
  end: [4000, 5000],
  height: 3000,
  thickness: 200,
});
const model = element({
  id: "model",
  name: "Facade",
  type: "imported",
  asset: "00000000-0000-4000-8000-000000000000",
  part: 0,
  bounds: { min: [0, 0, 0], max: [1000, 1000, 1000] },
});

const doc = (...elements: Element[]): SceneDocument =>
  ({
    version: 1,
    units: "mm",
    levels: [
      { id: "L1", name: "Level 1", elevation: 0 },
      { id: "L2", name: "Level 2", elevation: 3000 },
    ],
    elements: Object.fromEntries(elements.map((e) => [e.id, e])),
  }) as SceneDocument;

const plan = (text: string, scene: SceneDocument, ids: string[]): Plan => {
  const command = parseCommand(text);
  if (!command) throw new Error(`not a command: ${text}`);
  return planCommand(command, scene, ids);
};

describe("what a command acts on", () => {
  it("asks for a selection when there is none, and changes nothing", () => {
    expect(plan("rotate 90", doc(block), [])).toEqual({ kind: "error", message: "Select something first." });
  });

  it("ignores ids that are no longer in the model", () => {
    expect(plan("move 1 m x", doc(block), ["gone"])).toEqual({
      kind: "error",
      message: "Select something first.",
    });
  });

  it("can name its own with a leading select", () => {
    const result = plan("select all walls and move 2 m up", doc(block, wallA, wallB), []);
    expect(result).toMatchObject({ kind: "edit", select: ["wall-a", "wall-b"] });
    if (result.kind !== "edit") throw new Error("kind");
    expect(result.ops.map((op) => op.op === "update" && op.id)).toEqual(["wall-a", "wall-b"]);
  });

  it("says when a selector finds nothing", () => {
    expect(plan("select all columns", doc(block), [])).toEqual({
      kind: "error",
      message: "There is no columns.",
    });
    expect(plan("select level 3", doc(block), [])).toEqual({
      kind: "error",
      message: "There is no level 3.",
    });
  });

  it("selects by type, by level, or clears", () => {
    const scene = doc(block, wallA, wallB);
    expect(plan("select all walls", scene, [])).toMatchObject({ kind: "select", ids: ["wall-a", "wall-b"] });
    expect(plan("select level two", scene, [])).toMatchObject({ kind: "select", ids: ["wall-a"] });
    expect(plan("select none", scene, ["block"])).toMatchObject({ kind: "select", ids: [] });
  });
});

describe("a change of place", () => {
  it("is one update per element, in one plan", () => {
    const result = plan("move 3 m east then rotate 90", doc(block), ["block"]);
    expect(result).toMatchObject({ kind: "edit", label: "Move 3 m east, rotate 90°", select: null });
    if (result.kind !== "edit") throw new Error("kind");
    expect(result.ops).toHaveLength(1);
    expect(result.ops[0]).toMatchObject({ op: "update", id: "block", patch: { rotationDeg: 90 } });
  });

  it("refuses all of it when one element cannot take a step", () => {
    expect(plan("mirror x", doc(block, model), ["block", "model"])).toEqual({
      kind: "error",
      message: "Facade (imported) cannot be mirrored.",
    });
  });
});

describe("delete, hide and isolate", () => {
  it("delete waits to be confirmed and names what it deletes", () => {
    expect(plan("delete this", doc(block, wallA), ["block"])).toEqual({
      kind: "delete",
      label: "Delete Block",
      ids: ["block"],
    });
    expect(plan("delete all walls", doc(block, wallA, wallB), [])).toEqual({
      kind: "delete",
      label: "Delete 2 elements",
      ids: ["wall-a", "wall-b"],
    });
  });

  it("hide and isolate act on the selection; show all needs none", () => {
    expect(plan("hide", doc(block, wallA), ["wall-a"])).toMatchObject({ kind: "hide", ids: ["wall-a"] });
    expect(plan("isolate", doc(block, wallA), ["wall-a"])).toMatchObject({
      kind: "isolate",
      ids: ["wall-a"],
    });
    expect(plan("show all", doc(block), [])).toMatchObject({ kind: "showAll" });
  });
});

describe("the words for what happened", () => {
  it("says lengths the way a person would", () => {
    expect(lengthText(3000)).toBe("3 m");
    expect(lengthText(300)).toBe("30 cm");
    expect(lengthText(250)).toBe("25 cm");
    expect(lengthText(7)).toBe("7 mm");
    expect(lengthText(2500)).toBe("2.5 m");
  });

  it("labels a chain in the order it runs", () => {
    const command = parseCommand("move 6 m north, then rotate 90 and mirror x");
    expect(commandLabel(command?.clauses ?? [])).toBe("Move 6 m north, rotate 90°, mirror x");
  });
});

describe("markers", () => {
  const markers = [
    { letter: "A", point: [10000, 0, 0] as [number, number, number] },
    { letter: "B", point: [0, 5000, 0] as [number, number, number] },
  ];
  const plan = (text: string, ids = ["block"]) => {
    const command = parseCommand(text);
    if (!command) throw new Error(`not a command: ${text}`);
    return planCommand(command, doc(block), ids, markers);
  };
  const patchOf = (planned: Plan, id = "block") => {
    if (planned.kind !== "edit") throw new Error(`not an edit: ${JSON.stringify(planned)}`);
    const op = planned.ops.find((o) => o.op === "update" && o.id === id);
    return op?.op === "update" ? op.patch : null;
  };

  it("rotates about the marker, not about the block", () => {
    // A 4 x 2 m block with its centre at (2000, 1000), turned 90 degrees about (10000, 0): the centre goes to (9000, -8000).
    const patch = patchOf(plan("rotate 90 about marker A"));
    const origin = patch?.origin as number[];
    const size = block.type === "massing" ? block.size : [0, 0, 0];
    expect((origin[0] ?? 0) + (size[0] ?? 0) / 2).toBeCloseTo(9000);
    expect((origin[1] ?? 0) + (size[1] ?? 0) / 2).toBeCloseTo(-8000);
    expect(patch?.rotationDeg).toBe(90);
  });

  it("moves the block's centre to the marker", () => {
    const origin = patchOf(plan("move to marker A"))?.origin as number[];
    expect(origin).toEqual([10000 - 2000, 0 - 1000, 0]);
  });

  it("says when the marker has not been placed, and changes nothing", () => {
    const command = parseCommand("rotate 45 about marker Z");
    if (!command) throw new Error("not a command");
    expect(planCommand(command, doc(block), ["block"], markers)).toEqual({
      kind: "error",
      message: "There is no marker Z.",
    });
  });

  it("is named in the label", () => {
    expect(commandLabel(parseCommand("rotate 45 about marker B")?.clauses ?? [])).toBe(
      "Rotate 45° about marker B",
    );
    expect(commandLabel(parseCommand("move to marker A")?.clauses ?? [])).toBe("Move to marker A");
  });
});

describe("commands that made geometry", () => {
  it("a removed command: array 5 times changes nothing, and says arrays are made by asking the agent", () => {
    expect(plan("array 5 times", doc(block), ["block"])).toEqual({
      kind: "error",
      message: REMOVED_COMMAND.array,
    });
    expect(REMOVED_COMMAND.array).toMatch(/Ask the agent/);
    expect(plan("copy 3 m east", doc(block), ["block"])).toMatchObject({ kind: "error" });
    expect(plan("scale 2", doc(block), ["block"])).toMatchObject({ kind: "error" });
  });
});

describe("a command on a host's objects", () => {
  const canopy = {
    id: "a1",
    name: "Canopy",
    type: "brep",
    layer: "Roof",
    color: null,
    bounds: { min: [0, 0, 3000], max: [4000, 2000, 3200] },
    asset: null,
    triangles: 0,
    tags: {},
  } as const;
  const targets = { host: "rhino" as const, objects: [{ ...canopy, bounds: { ...canopy.bounds } }] };
  const onHost = (text: string) => {
    const command = parseCommand(text);
    if (!command) throw new Error(`not a command: ${text}`);
    return planHostCommand(command, targets as never, [{ letter: "A", point: [10_000, 0, 0] }]);
  };

  it("a spoken move on a host object: one transform of 2000 mm along x", () => {
    expect(onHost("move this 2 metres to the right")).toEqual({
      kind: "hostEdit",
      host: "rhino",
      label: "Move Canopy 2 m east",
      op: { op: "transform", ids: ["a1"], matrix: [1, 0, 0, 2000, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    });
  });

  it("a turn goes about the middle of the footprint, and a chain is one matrix", () => {
    const turned = onHost("rotate 90");
    if (turned.kind !== "hostEdit" || turned.op.op !== "transform") throw new Error("not an edit");
    // 90 degrees about (2000, 1000): x' = -y + 3000, y' = x - 1000.
    expect(turned.op.matrix.map((v) => Math.round(v))).toEqual([
      0, -1, 0, 3000, 1, 0, 0, -1000, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    const chained = onHost("move 1 m east and rotate 90");
    if (chained.kind !== "hostEdit" || chained.op.op !== "transform") throw new Error("not an edit");
    // The turn is about the middle after the move, (3000, 1000).
    expect(chained.op.matrix.map((v) => Math.round(v))).toEqual([
      0, -1, 0, 4000, 1, 0, 0, -1000, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
  });

  it("moves the middle of the footprint to a marker, at its own height", () => {
    const moved = onHost("move to marker A");
    if (moved.kind !== "hostEdit" || moved.op.op !== "transform") throw new Error("not an edit");
    expect(moved.op.matrix).toEqual([1, 0, 0, 8000, 0, 1, 0, -1000, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it("a delete is asked first; hide and groups are HAI's own and say so", () => {
    expect(onHost("delete this")).toEqual({
      kind: "hostDelete",
      host: "rhino",
      label: "Delete Canopy",
      ids: ["a1"],
    });
    expect(onHost("hide")).toMatchObject({ kind: "error", message: expect.stringContaining("Rhino") });
    expect(onHost("array 5 times")).toEqual({ kind: "error", message: REMOVED_COMMAND.array });
  });
});
