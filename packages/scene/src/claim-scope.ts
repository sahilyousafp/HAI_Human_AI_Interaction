import { type Element, type SceneDocument, TAG_PART, type TaskScope } from "@hai/protocol";
import { type BoundsMm, elementBounds } from "./bounds.ts";

/**
 * Which part of the model a task's scope takes in. The bridge enforces claims with this and the viewer draws them with
 * it, so what a claim holds can never differ between the two.
 */

type Region = NonNullable<TaskScope["region"]>;

/** Whether the box meets the region in x and y, and in z when the region has one. Touching edges do not count. */
export function regionIntersects(bounds: BoundsMm, region: Region): boolean {
  for (let axis = 0; axis < region.min.length; axis++) {
    const low = region.min[axis] as number;
    const high = region.max[axis] as number;
    if ((bounds.max[axis] as number) <= low || (bounds.min[axis] as number) >= high) return false;
  }
  return true;
}

/** Whether the box lies wholly inside the region. */
export function regionContains(bounds: BoundsMm, region: Region): boolean {
  for (let axis = 0; axis < region.min.length; axis++) {
    if ((bounds.min[axis] as number) < (region.min[axis] as number)) return false;
    if ((bounds.max[axis] as number) > (region.max[axis] as number)) return false;
  }
  return true;
}

/** Whether two regions share volume. */
export function regionsOverlap(a: Region, b: Region): boolean {
  const axes = Math.min(a.min.length, b.min.length);
  for (let axis = 0; axis < axes; axis++) {
    if ((a.max[axis] as number) <= (b.min[axis] as number)) return false;
    if ((b.max[axis] as number) <= (a.min[axis] as number)) return false;
  }
  return true;
}

/** Whether a part tag is this part or one of its sub-parts (`dome/ribs` is in `dome`). */
export function partIncludes(part: string, tag: string | undefined): boolean {
  return tag !== undefined && (tag === part || tag.startsWith(`${part}/`));
}

/** Whether a region lies wholly inside another, on the axes both have. */
export function regionWithin(inner: Region, outer: Region): boolean {
  const axes = Math.min(inner.min.length, outer.min.length);
  for (let axis = 0; axis < axes; axis++) {
    if ((inner.min[axis] as number) < (outer.min[axis] as number)) return false;
    if ((inner.max[axis] as number) > (outer.max[axis] as number)) return false;
  }
  return true;
}

/**
 * Whether a scope lies inside a claim (null is the whole model): each id must be an element the claim takes in, a
 * region must lie inside the claim's region, and a part must be the claim's part or one of its sub-parts
 * (`dome/ribs` inside `dome`). The reason is worded for the agent that asked.
 */
export function scopeWithin(
  scope: TaskScope,
  claim: TaskScope | null,
  doc: SceneDocument,
): { ok: true } | { ok: false; reason: string } {
  if (!claim) return { ok: true };
  for (const id of scope.ids ?? []) {
    const element = doc.elements[id];
    if (!element) return { ok: false, reason: `there is no element "${id}"` };
    if (!scopeCovers(claim, id, element.tags, elementBounds(element, doc.levels)))
      return { ok: false, reason: `the element "${id}" is not in your claim` };
  }
  if (scope.region) {
    if (!claim.region) return { ok: false, reason: "your claim has no region, so a region is outside it" };
    if (!regionWithin(scope.region, claim.region))
      return { ok: false, reason: "the region reaches outside the region of your claim" };
  }
  if (scope.part !== undefined) {
    if (claim.part === undefined)
      return { ok: false, reason: `your claim has no part, so the part "${scope.part}" is outside it` };
    if (!partIncludes(claim.part, scope.part))
      return {
        ok: false,
        reason: `the part "${scope.part}" is outside your claim; a part inside "${claim.part}" is written "${claim.part}/<name>"`,
      };
  }
  return { ok: true };
}

/**
 * Whether a scope takes in something with an id, tags and a box. `fresh` is something about to be created, which
 * must lie wholly inside a region; an existing one need only meet it. A scope of null is the whole model.
 */
export function scopeCovers(
  scope: TaskScope | null,
  id: string,
  tags: Record<string, string> | undefined,
  bounds: BoundsMm | null,
  fresh = false,
): boolean {
  if (!scope) return true;
  if (scope.ids?.includes(id)) return true;
  if (scope.part !== undefined && partIncludes(scope.part, tags?.[TAG_PART])) return true;
  if (scope.region && bounds)
    return fresh ? regionContains(bounds, scope.region) : regionIntersects(bounds, scope.region);
  return false;
}

/** The elements of a scene that a scope takes in. */
export function elementsInScope(scope: TaskScope | null, doc: SceneDocument): Element[] {
  return Object.values(doc.elements).filter((e) =>
    scopeCovers(scope, e.id, e.tags, elementBounds(e, doc.levels)),
  );
}

/** How a scope reads in a sentence: `the part "dome" and the region x 0 to 5000, y 0 to 5000`. */
export function describeScope(scope: TaskScope | null): string {
  if (!scope) return "the whole model";
  const parts: string[] = [];
  if (scope.part) parts.push(`the part "${scope.part}"`);
  if (scope.ids) {
    const named = scope.ids.slice(0, 6).join(", ");
    const more = scope.ids.length - 6;
    parts.push(`the elements ${named}${more > 0 ? ` and ${more} more` : ""}`);
  }
  if (scope.region) {
    const { min, max } = scope.region;
    parts.push(`the region x ${min[0]} to ${max[0]}, y ${min[1]} to ${max[1]}`);
  }
  return parts.join(" and ");
}
