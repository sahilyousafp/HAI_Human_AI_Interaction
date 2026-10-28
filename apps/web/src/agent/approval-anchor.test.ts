import { Element, type SceneDocument } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { approvalAnchor } from "./approval-anchor.ts";

const make = (value: Record<string, unknown>) => Element.parse({ properties: {}, ...value });
const doc = (...elements: Element[]): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "t",
  levels: [],
  elements: Object.fromEntries(elements.map((e) => [e.id, e])),
});

const tower = make({
  id: "tower",
  name: "Tower",
  type: "massing",
  origin: [0, 0, 0],
  size: [4000, 2000, 9000],
});
const shed = make({
  id: "shed",
  name: "Shed",
  type: "massing",
  origin: [10000, 0, 0],
  size: [2000, 2000, 3000],
  tags: { "hai.owner": "architect" },
});

describe("approvalAnchor", () => {
  it("sits on the top middle of the element a tool names", () => {
    const anchor = approvalAnchor({ input: { ids: ["tower"], steps: [] } }, doc(tower, shed));
    expect(anchor).toEqual({ point: [2000, 1000, 9000], ids: ["tower"] });
  });

  it("finds ids at any level of the input: a loft's sections, a boolean's two groups", () => {
    const anchor = approvalAnchor(
      { input: { a: ["tower"], b: ["shed"], operation: "union" } },
      doc(tower, shed),
    );
    expect(anchor?.ids.sort()).toEqual(["shed", "tower"]);
    expect(anchor?.point).toEqual([6000, 1000, 9000]);
  });

  it("ignores words that only look like ids, and the script of a code tool", () => {
    const anchor = approvalAnchor({ input: { code: "tower", title: "shed" } }, doc(tower, shed));
    expect(anchor?.ids).toEqual([]);
  });

  it("falls back to the elements the asking agent owns", () => {
    const anchor = approvalAnchor({ input: { code: "x" }, agent: "Architect" }, doc(tower, shed));
    expect(anchor).toEqual({ point: [11000, 1000, 3000], ids: ["shed"] });
  });

  it("a worker counts as its specialist", () => {
    const anchor = approvalAnchor({ input: {}, agent: "architect.2" }, doc(tower, shed));
    expect(anchor?.ids).toEqual(["shed"]);
  });

  it("falls back to the whole model, and is null for an empty one", () => {
    expect(approvalAnchor({ input: {} }, doc(tower, shed))?.ids).toEqual([]);
    expect(approvalAnchor({ input: {} }, doc(tower, shed))?.point[2]).toBe(9000);
    expect(approvalAnchor({ input: {} }, doc())).toBeNull();
  });
});
