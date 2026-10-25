import {
  RESERVED_TAG_PREFIX,
  type SceneDocument,
  type SceneOp,
  TAG_OWNER,
  TAG_PART,
  type Tags,
} from "@hai/protocol";

type TagRecord = Record<string, string>;

const reservedOf = (tags: TagRecord | undefined): TagRecord =>
  Object.fromEntries(Object.entries(tags ?? {}).filter(([name]) => name.startsWith(RESERVED_TAG_PREFIX)));

const sameReserved = (a: TagRecord | undefined, b: TagRecord | undefined): boolean => {
  const x = reservedOf(a);
  const y = reservedOf(b);
  const names = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const name of names) if (x[name] !== y[name]) return false;
  return true;
};

const asTags = (value: unknown): TagRecord | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as TagRecord) : undefined;

/**
 * Names starting with `hai.` belong to the system. An agent's change is refused when it would add, change or remove
 * one (an agent cannot give an element to another owner by writing the tag). Returns the message, or null when fine.
 */
export function reservedTagRefusal(ops: SceneOp[], doc: SceneDocument): string | null {
  // Tags of elements this batch creates, so a later update in the same batch is held to the same rule.
  const made = new Map<string, TagRecord | undefined>();
  const refusal = (id: string) =>
    `Element "${id}": tag names starting with "${RESERVED_TAG_PREFIX}" are set by the system (hai.owner, hai.part, hai.source) and cannot be written. Nothing was changed.`;
  for (const op of ops) {
    if (op.op === "create") {
      if (Object.keys(reservedOf(op.element.tags)).length > 0) return refusal(op.element.id);
      made.set(op.element.id, undefined);
    } else if (op.op === "update" && "tags" in op.patch) {
      const current = made.has(op.id) ? made.get(op.id) : doc.elements[op.id]?.tags;
      if (!sameReserved(current, asTags(op.patch.tags))) return refusal(op.id);
    }
  }
  return null;
}

/**
 * Puts the agent's name on what it makes: a created element gets `hai.owner` (and `hai.part` when the task has a
 * part), and an element the agent changes that belonged to someone else (or to nobody) becomes its own. The agent
 * never writes these; the system does, after `reservedTagRefusal` has kept the agent's own tags clear of them.
 */
export function stampOps(ops: SceneOp[], doc: SceneDocument, agent: string, part?: string): SceneOp[] {
  return ops.map((op): SceneOp => {
    if (op.op === "create") {
      const tags: Tags = {
        ...(op.element.tags ?? {}),
        [TAG_OWNER]: agent,
        ...(part ? { [TAG_PART]: part } : {}),
      };
      return { op: "create", element: { ...op.element, tags } };
    }
    if (op.op !== "update") return op;
    const current = doc.elements[op.id];
    if (!current) return op;
    const after = "tags" in op.patch ? (asTags(op.patch.tags) ?? {}) : (current.tags ?? {});
    if (after[TAG_OWNER] === agent) return op;
    return { ...op, patch: { ...op.patch, tags: { ...after, [TAG_OWNER]: agent } } };
  });
}

/** How many elements each value of a tag has, and how many have none: `{ counts, without }`. */
export function countByTag(
  doc: SceneDocument,
  name: string,
): { counts: Record<string, number>; without: number } {
  const counts: Record<string, number> = {};
  let without = 0;
  for (const element of Object.values(doc.elements)) {
    const value = element.tags?.[name];
    if (value === undefined) without += 1;
    else counts[value] = (counts[value] ?? 0) + 1;
  }
  return { counts, without };
}
