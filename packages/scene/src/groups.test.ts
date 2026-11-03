import type { Element, SceneDocument } from "@hai/protocol";
import { TAG_GROUP, TAG_OWNER } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { copiedTags, expandToGroups, groupOf, groupOps, membersOf, soleGroup, ungroupOps } from "./groups.ts";
import { applyTransaction } from "./ops.ts";

const column = (id: string, group?: string): Element => ({
  id,
  name: id,
  type: "column",
  properties: {},
  position: [0, 0],
  section: [400, 400],
  height: 3000,
  ...(group ? { tags: { [TAG_GROUP]: group, [TAG_OWNER]: "architect" } } : {}),
});

const doc: SceneDocument = {
  version: 1,
  units: "mm",
  up: "Z",
  name: "test",
  levels: [],
  elements: Object.fromEntries(
    [column("a", "g1"), column("b", "g1"), column("c", "g2"), column("d")].map((e) => [e.id, e]),
  ),
};

describe("groups", () => {
  it("finds a group's members", () => {
    expect(membersOf(doc, "g1")).toEqual(["a", "b"]);
    expect(groupOf(doc.elements.d)).toBeUndefined();
  });

  it("makes a group whole, keeps the ids given first, and adds nothing for ungrouped ids", () => {
    expect(expandToGroups(doc, ["b"])).toEqual(["b", "a"]);
    expect(expandToGroups(doc, ["d"])).toEqual(["d"]);
    expect(expandToGroups(doc, ["d", "a"])).toEqual(["d", "a", "b"]);
    expect(expandToGroups(doc, ["gone"])).toEqual(["gone"]);
  });

  it("says when ids are exactly one group", () => {
    expect(soleGroup(doc, ["a", "b"])).toBe("g1");
    expect(soleGroup(doc, ["b", "a"])).toBe("g1");
    expect(soleGroup(doc, ["a"])).toBeNull(); // part of it
    expect(soleGroup(doc, ["a", "b", "c"])).toBeNull();
    expect(soleGroup(doc, ["d"])).toBeNull();
    expect(soleGroup(doc, [])).toBeNull();
  });

  it("groups as ordinary updates, moving an element out of its old group, and that undoes", () => {
    const done = applyTransaction(doc, groupOps(doc, ["a", "d"], "g3"));
    if (!done.ok) throw new Error(done.error);
    expect(membersOf(done.doc, "g3")).toEqual(["a", "d"]);
    expect(membersOf(done.doc, "g1")).toEqual(["b"]);
    expect(done.doc.elements.a?.tags?.[TAG_OWNER]).toBe("architect"); // other tags stay
    const undone = applyTransaction(done.doc, done.inverse);
    if (!undone.ok) throw new Error(undone.error);
    expect(undone.doc.elements).toEqual(doc.elements);
  });

  it("ungroups, keeping the other tags and leaving the ungrouped alone", () => {
    const ops = ungroupOps(doc, ["a", "d"]);
    expect(ops).toHaveLength(1);
    const done = applyTransaction(doc, ops);
    if (!done.ok) throw new Error(done.error);
    expect(groupOf(done.doc.elements.a)).toBeUndefined();
    expect(done.doc.elements.a?.tags?.[TAG_OWNER]).toBe("architect");
    expect(groupOf(done.doc.elements.b)).toBe("g1");
  });

  it("gives copies of a group one new group of their own, and nothing to the ungrouped", () => {
    const fresh = new Map<string, string>();
    const [a, b] = [copiedTags(column("a", "g1"), fresh), copiedTags(column("b", "g1"), fresh)];
    expect(a?.[TAG_GROUP]).toBe(b?.[TAG_GROUP]);
    expect(a?.[TAG_GROUP]).not.toBe("g1");
    expect(copiedTags(column("d"), fresh)).toBeUndefined();
    expect(copiedTags(column("a", "g1"), new Map())?.[TAG_GROUP]).not.toBe(a?.[TAG_GROUP]);
  });
});
