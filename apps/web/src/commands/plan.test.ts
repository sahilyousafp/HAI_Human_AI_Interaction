import { type Element, Element as ElementSchema, type SceneDocument } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { parseCommand } from "./grammar.ts";
import { commandLabel, lengthText, type Plan, planCommand } from "./plan.ts";

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

describe("copies", () => {
  it("copy and rotate leaves the original and turns the copy about itself", () => {
    const result = plan("copy and rotate 90", doc(block), ["block"]);
    if (result.kind !== "edit") throw new Error("kind");
    expect(result.label).toBe("Copy, rotate 90°");
    expect(result.ops).toHaveLength(1);
    const [op] = result.ops;
    expect(op).toMatchObject({
      op: "create",
      element: { type: "massing", name: "Block copy", rotationDeg: 90 },
    });
    expect(result.select).toHaveLength(1);
  });

  it("an array puts each copy one step further along", () => {
    const result = plan("copy 3 times 6 m along y", doc(block), ["block"]);
    if (result.kind !== "edit") throw new Error("kind");
    const origins = result.ops.map((op) =>
      op.op === "create" && op.element.type === "massing" ? op.element.origin[1] : null,
    );
    expect(origins).toEqual([6000, 12000, 18000]);
    expect(result.ops.map((op) => op.op === "create" && op.element.name)).toEqual([
      "Block copy 1",
      "Block copy 2",
      "Block copy 3",
    ]);
    expect(new Set(result.select).size).toBe(3);
  });

  it("what comes after the copy acts on each copy, what comes before on the original", () => {
    const result = plan("rotate 90 then copy 3 m x", doc(block), ["block"]);
    if (result.kind !== "edit") throw new Error("kind");
    expect(result.ops[0]).toMatchObject({ op: "update", id: "block", patch: { rotationDeg: 90 } });
    expect(result.ops[1]).toMatchObject({ op: "create", element: { rotationDeg: 90 } });
  });

  it("will not make more than 500 elements", () => {
    const many = doc(block, wallA, wallB);
    expect(plan("copy 200 times 1 m x", many, ["block", "wall-a", "wall-b"])).toEqual({
      kind: "error",
      message: "That makes more than 500 copies.",
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
    const command = parseCommand("copy 4 times 6 m north, then scale 0.5 and mirror x");
    expect(commandLabel(command?.clauses ?? [])).toBe("Copy 4 times 6 m north, scale 0.5, mirror x");
  });
});
