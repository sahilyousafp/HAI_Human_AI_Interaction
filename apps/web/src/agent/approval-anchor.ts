import { type Point3Mm, type SceneDocument, TAG_OWNER } from "@hai/protocol";
import { elementBounds, unionBounds } from "@hai/scene";
import { baseAgent } from "./owners.ts";

/** Where a permission request is drawn in the model: over this point, and these are the elements it concerns. */
export interface ApprovalAnchor {
  /** The middle of the top of what the request concerns, millimetres. */
  point: Point3Mm;
  ids: string[];
}

/** The most elements one request is taken to concern. */
const MAX_IDS = 50;

/** Fields that are words to read, not references: a script, a title, a name. */
const NOT_REFERENCES = new Set(["code", "title", "name", "summary"]);

/** The ids in a tool's input: every string or list of strings that names an element, nested a few levels down. */
function idsIn(input: unknown, doc: SceneDocument): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (typeof value === "string") {
      if (doc.elements[value]) found.add(value);
    } else if (Array.isArray(value) && depth < 3) {
      for (const item of value) visit(item, depth + 1);
    } else if (value && typeof value === "object" && depth < 3) {
      for (const [key, item] of Object.entries(value)) if (!NOT_REFERENCES.has(key)) visit(item, depth + 1);
    }
  };
  visit(input, 0);
  return [...found].slice(0, MAX_IDS);
}

/**
 * The elements a permission request is about, and where to draw it: the elements its input names (an id, a list of ids,
 * sections and rails), else the ones the asking agent owns, else the whole model. Null only when the model is empty.
 */
export function approvalAnchor(
  request: { input: unknown; agent?: string | undefined },
  doc: SceneDocument,
): ApprovalAnchor | null {
  let ids = idsIn(request.input, doc);
  if (ids.length === 0 && request.agent) {
    const owner = baseAgent(request.agent.toLowerCase());
    ids = Object.values(doc.elements)
      .filter((e) => baseAgent((e.tags?.[TAG_OWNER] ?? "").toLowerCase()) === owner)
      .map((e) => e.id)
      .slice(0, MAX_IDS);
  }
  const concerned = ids.length > 0 ? ids : Object.keys(doc.elements);
  const box = unionBounds(
    concerned.flatMap((id) => (doc.elements[id] ? [elementBounds(doc.elements[id], doc.levels)] : [])),
  );
  if (!box) return null;
  return {
    point: [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, box.max[2]],
    ids,
  };
}
