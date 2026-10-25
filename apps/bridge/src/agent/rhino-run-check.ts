import type { RhinoChange, RhinoRunChanges } from "@hai/protocol";
import type { BoundsMm } from "@hai/scene";
import { type Claim, type ClaimTable, describeScope } from "./claims.ts";

/** An object a script added, changed or deleted outside the claim it ran under. */
export interface Stray {
  id: string;
  name: string;
  what: "added" | "changed" | "deleted";
  /** Whose claim the object is in, when another task's: "product's task "hall"". */
  holder?: string;
}

/** Stray objects listed at most, so one runaway script does not flood a message. */
export const MAX_STRAYS = 100;

const boundsOf = (change: RhinoChange): BoundsMm | null => change.bounds;

/**
 * What a Rhino script did outside its claim, found by comparing the document before and after the run. A script is not
 * sandboxed, so this cannot stop anything; it says what happened so the agent and the user can put it right (the run
 * is one undo step in Rhino).
 *
 * - A changed or deleted object must lie in the task's claim, and must not be in another running task's.
 * - An added object is outside only when the claim has a part or region it does not meet, or when it is in another
 *   task's claim. A claim of listed ids cannot name objects that did not exist, so new objects are not strays there.
 * - A task with no scope has the whole model, so only objects in another running task's claim count.
 */
export function findStrays(
  changes: RhinoRunChanges,
  own: Claim | undefined,
  claims: ClaimTable,
): { strays: Stray[]; truncated: boolean } {
  if (!own) return { strays: [], truncated: false };
  const strays: Stray[] = [];
  const check = (change: RhinoChange, what: Stray["what"]) => {
    const bounds = boundsOf(change);
    const held = claims.all
      .filter((c) => c.taskId !== own.taskId && claims.coversObject(c, change.id, change.tags, bounds))
      .sort((a, b) => a.order - b.order)[0];
    const added = what === "added";
    const idsOnly = !own.scope?.part && !own.scope?.region && own.scope?.ids !== undefined;
    const inOwn =
      claims.coversObject(own, change.id, change.tags, bounds, added) || (added && idsOnly) || !own.scope;
    if (inOwn && !held) return;
    strays.push({
      id: change.id,
      name: change.name,
      what,
      ...(held ? { holder: `${held.agent}'s task "${held.title}" (${describeScope(held.scope)})` } : {}),
    });
  };
  for (const change of changes.added) check(change, "added");
  for (const change of changes.changed) check(change, "changed");
  for (const change of changes.deleted) check(change, "deleted");
  return { strays: strays.slice(0, MAX_STRAYS), truncated: changes.truncated || strays.length > MAX_STRAYS };
}

/** What the agent is told when a run strayed: plain about what happened, and that it was only checked afterwards. */
export function strayNote(strays: Stray[], truncated: boolean): string {
  const lines = strays.slice(0, 8).map((s) => {
    const who = s.holder ? `, in ${s.holder}` : "";
    return `- ${s.what} "${s.name}" (${s.id})${who}`;
  });
  const more = strays.length > 8 || truncated ? "\n- and more" : "";
  return `Checked after the run (a script cannot be stopped from doing this): it touched objects outside your claim.\n${lines.join("\n")}${more}\nThe run was one undo step in Rhino, and the user has been offered to undo it. Do not repeat it; ask for the scope you need with request_claim, or tell the user.`;
}
