import type { Element, SceneDocument, SceneOp } from "@hai/protocol";
import { expandToGroups, soleGroup } from "@hai/scene";
import type { ToolContext } from "./types.ts";

/**
 * What a tool acts on when it is used on `grabbed`: the whole selection when `grabbed` is part of a selection of
 * several, else `grabbed` with the rest of its group. Hidden elements are left out. Every tool that acts on elements
 * goes through this, so a selection means the same to all of them.
 */
export function actedOn(ctx: ToolContext, grabbed: Element): Element[] {
  const doc = ctx.doc();
  if (!doc) return [grabbed];
  const selected = ctx.selection();
  const ids =
    selected.length >= 2 && selected.includes(grabbed.id) ? selected : expandToGroups(doc, [grabbed.id]);
  const hidden = ctx.hidden();
  const elements = ids.flatMap((id) => {
    const element = doc.elements[id];
    return element && !hidden.has(id) ? [element] : [];
  });
  return elements.length > 0 ? elements : [grabbed];
}

/** Elements in a few words: "Massing 3", "group of 14", "3 elements". */
export function describeElements(doc: SceneDocument, elements: Element[]): string {
  const [first] = elements;
  if (elements.length === 1 && first) return first.name;
  return soleGroup(
    doc,
    elements.map((element) => element.id),
  )
    ? `group of ${elements.length}`
    : `${elements.length} elements`;
}

/** Marks elements and asks once whether to delete them all: a nod or Enter deletes, a shake or Escape keeps them. */
export function confirmDelete(ctx: ToolContext, doomed: Element[]): void {
  const doc = ctx.doc();
  const what = doc ? describeElements(doc, doomed) : (doomed[0]?.name ?? "this");
  ctx.setOverlay({ marked: doomed.map((e) => e.id), notice: null });
  ctx.confirm(`Delete ${what}? Nod or press Enter to delete. Shake or press Escape to keep it.`, (yes) => {
    ctx.setOverlay({ marked: [] });
    if (yes)
      ctx.apply(
        "Delete",
        doomed.map((e): SceneOp => ({ op: "delete", id: e.id })),
      );
    else ctx.flash(`Kept ${what}.`);
  });
}
