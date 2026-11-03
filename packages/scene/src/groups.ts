import { type Element, type SceneDocument, type SceneOp, TAG_GROUP } from "@hai/protocol";

/**
 * A group is elements that hold together: selecting, moving, turning, copying or deleting one means all of them. It is
 * a system tag on each member and not a section of the document, so it travels with the element through undo, saving
 * and the Rhino connector. Groups do not nest, and an element belongs to one.
 */

/** A new group's id. */
export const newGroupId = (): string => `group-${crypto.randomUUID().slice(0, 8)}`;

/** The group an element belongs to, if any. */
export const groupOf = (element: Element | undefined): string | undefined => element?.tags?.[TAG_GROUP];

/** The ids of a group's members. */
export function membersOf(doc: SceneDocument, group: string): string[] {
  return Object.values(doc.elements)
    .filter((element) => groupOf(element) === group)
    .map((element) => element.id);
}

/** The ids with every group one of them belongs to made whole: what is meant, wherever the ids came from. */
export function expandToGroups(doc: SceneDocument, ids: readonly string[]): string[] {
  const groups = new Set(ids.flatMap((id) => groupOf(doc.elements[id]) ?? []));
  if (groups.size === 0) return [...ids];
  const members = Object.values(doc.elements).filter((element) => {
    const group = groupOf(element);
    return group !== undefined && groups.has(group);
  });
  return [...new Set([...ids, ...members.map((element) => element.id)])];
}

/** The group the ids are, when they are exactly the members of one. */
export function soleGroup(doc: SceneDocument, ids: readonly string[]): string | null {
  const group = groupOf(doc.elements[ids[0] ?? ""]);
  if (!group) return null;
  const members = membersOf(doc, group);
  return members.length === ids.length && ids.every((id) => members.includes(id)) ? group : null;
}

/** The ops that make the elements one group, taking them out of any group they were in. */
export function groupOps(doc: SceneDocument, ids: readonly string[], group: string): SceneOp[] {
  return ids.flatMap((id): SceneOp[] => {
    const element = doc.elements[id];
    if (!element) return [];
    return [{ op: "update", id, patch: { tags: { ...element.tags, [TAG_GROUP]: group } } }];
  });
}

/** The ops that take the elements out of their groups; those in none are left alone. */
export function ungroupOps(doc: SceneDocument, ids: readonly string[]): SceneOp[] {
  return ids.flatMap((id): SceneOp[] => {
    const element = doc.elements[id];
    if (!groupOf(element) || !element?.tags) return [];
    const { [TAG_GROUP]: _group, ...tags } = element.tags;
    return [{ op: "update", id, patch: { tags } }];
  });
}

/**
 * The tags a copy takes so that it holds together with its fellow copies and not with its original: a copied group is
 * a new group. `fresh` keeps the new id of each group for one round of copies.
 */
export function copiedTags(element: Element, fresh: Map<string, string>): Element["tags"] {
  const group = groupOf(element);
  if (!group) return element.tags;
  const copy = fresh.get(group) ?? newGroupId();
  fresh.set(group, copy);
  return { ...element.tags, [TAG_GROUP]: copy };
}
