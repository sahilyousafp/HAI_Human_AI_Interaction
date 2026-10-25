import type { SceneDocument, TaskScope, TeamClaim, TeamMemberInfo } from "@hai/protocol";
import { elementBounds, unionBounds } from "@hai/scene";

/** The specialist a worker was started from (`architect.2` is a worker of `architect`); any other name is its own. */
export const baseAgent = (name: string): string => name.replace(/\.\d+$/, "");

/** The colour of the agent with this name (case does not matter; a worker has its specialist's), or undefined. */
function colorOf(members: TeamMemberInfo[], name: string | undefined): string | undefined {
  if (!name) return undefined;
  const wanted = baseAgent(name.toLowerCase());
  return members.find((m) => m.name.toLowerCase() === wanted)?.color;
}

/** Each agent's colour by its lower-case name: what an element's or object's `hai.owner` tag is looked up in. */
export function agentColors(members: TeamMemberInfo[]): Map<string, string> {
  return new Map(members.map((m) => [m.name.toLowerCase(), m.color]));
}

/** A translucent box that marks a region claim, in millimetres. */
export interface ClaimBox {
  key: string;
  color: string;
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * The boxes for the claims that have a region. A region without a height spans the model's height (or a storey's
 * worth when the scene is empty), so it reads as the column of space the agent works in.
 */
export function claimBoxes(
  claims: TeamClaim[],
  members: TeamMemberInfo[],
  doc: SceneDocument | null,
): ClaimBox[] {
  const bounds = doc
    ? unionBounds(Object.values(doc.elements).map((e) => elementBounds(e, doc.levels)))
    : null;
  const low = Math.min(0, bounds?.min[2] ?? 0);
  const high = Math.max(3000, bounds?.max[2] ?? 3000);
  return claims.flatMap((claim) => {
    const region = claim.scope?.region;
    if (!region) return [];
    const [x0, y0, z0] = region.min;
    const [x1, y1, z1] = region.max;
    return [
      {
        key: claim.taskId,
        color: colorOf(members, claim.agent) ?? "#8e8e93",
        min: [x0, y0, z0 ?? low] as [number, number, number],
        max: [x1, y1, z1 ?? high] as [number, number, number],
      },
    ];
  });
}

/** What a claim holds in a few words, for a chip or a list row: `part dome`, `3 elements`, `region`. */
export function scopeLabel(scope: TaskScope | null): string {
  if (!scope) return "the whole model";
  const parts: string[] = [];
  if (scope.part) parts.push(`part ${scope.part}`);
  if (scope.ids) parts.push(`${scope.ids.length} ${scope.ids.length === 1 ? "element" : "elements"}`);
  if (scope.region) parts.push("region");
  return parts.join(" + ");
}
