import type { Element, RequestContext, SceneDocument } from "@hai/protocol";
import { MAX_REQUEST_REFERENCES, MAX_REQUEST_SELECTION, TAG_GROUP } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { groupForRequest } from "./request-group.ts";

const column = (id: string, x: number, group?: string): Element => ({
  id,
  name: id,
  type: "column",
  properties: {},
  position: [x, 0],
  section: [400, 400],
  height: 3000,
  ...(group ? { tags: { [TAG_GROUP]: group } } : {}),
});
const docOf = (...elements: Element[]): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "t",
  levels: [],
  elements: Object.fromEntries(elements.map((e) => [e.id, e])),
});
const pointedAt = (...ids: string[]): RequestContext => ({
  references: ids.map((id) => ({ id, type: "column", name: id })),
  selection: [],
  groundPoint: null,
});

describe("a request about several elements", () => {
  it("groups a selection and names the group, with how many and where", () => {
    const doc = docOf(column("a", 0), column("b", 10_000));
    const { context, ops } = groupForRequest(doc, undefined, ["a", "b"]);
    expect(ops).toHaveLength(2);
    expect(context?.group?.count).toBe(2);
    expect(context?.group?.centre).toEqual([5000, 0, 1500]);
    expect(context?.selection).toEqual(["a", "b"]);
    const tag = ops[0]?.op === "update" ? (ops[0].patch.tags as Record<string, string>)[TAG_GROUP] : "";
    expect(tag).toBe(context?.group?.id);
  });

  it("goes by what was pointed at when something was", () => {
    const doc = docOf(column("a", 0), column("b", 10_000), column("c", 20_000));
    const { context, ops } = groupForRequest(doc, pointedAt("a", "b"), ["c"]);
    expect(ops.map((op) => (op.op === "update" ? op.id : ""))).toEqual(["a", "b"]);
    expect(context?.group?.count).toBe(2);
  });

  it("does nothing new when they are one group already", () => {
    const doc = docOf(column("a", 0, "g"), column("b", 10_000, "g"));
    const { context, ops } = groupForRequest(doc, undefined, ["a", "b"]);
    expect(ops).toEqual([]);
    expect(context?.group?.id).toBe("g");
  });

  it("pointing at one member names its whole group", () => {
    const doc = docOf(column("a", 0, "g"), column("b", 10_000, "g"));
    const { context, ops } = groupForRequest(doc, pointedAt("a"), []);
    expect(ops).toEqual([]);
    expect(context?.group).toMatchObject({ id: "g", count: 2 });
  });

  it("leaves a request about one element or none as it is", () => {
    const doc = docOf(column("a", 0), column("b", 10_000));
    const one = pointedAt("a");
    expect(groupForRequest(doc, one, [])).toEqual({ context: one, ops: [] });
    expect(groupForRequest(doc, undefined, [])).toEqual({ context: undefined, ops: [] });
    expect(groupForRequest(null, one, ["a", "b"])).toEqual({ context: one, ops: [] });
  });

  it("keeps a group larger than a request can list within the limits, and counts all of it", () => {
    const many = Array.from({ length: MAX_REQUEST_SELECTION + 20 }, (_, i) => column(`c${i}`, i * 1000, "g"));
    const ids = many.map((e) => e.id);
    const context: RequestContext = { ...pointedAt(...ids), selection: ids };
    const prepared = groupForRequest(docOf(...many), context, ids).context;
    expect(prepared?.references).toHaveLength(MAX_REQUEST_REFERENCES);
    expect(prepared?.selection).toHaveLength(MAX_REQUEST_SELECTION);
    expect(prepared?.group?.count).toBe(many.length);
  });
});
