import { Element, elementIssue, type SceneDocument, type SceneOp } from "@hai/protocol";

export type OpResult = { ok: true; doc: SceneDocument; inverse: SceneOp } | { ok: false; error: string };
export type TransactionResult =
  | { ok: true; doc: SceneDocument; inverse: SceneOp[] }
  | { ok: false; error: string };

function validate(
  candidate: unknown,
  id: string,
  doc: SceneDocument,
): { ok: true; element: Element } | { ok: false; error: string } {
  const parsed = Element.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: elementIssue(id, issue?.path.join(".") ?? "", issue?.message ?? "is invalid"),
    };
  }
  if (parsed.data.level && !doc.levels.some((l) => l.id === parsed.data.level)) {
    return { ok: false, error: `Element "${id}": level "${parsed.data.level}" does not exist` };
  }
  return { ok: true, element: parsed.data };
}

/** Applies one operation without mutating `doc`, returning the new document and the operation that undoes it. */
export function applyOp(doc: SceneDocument, op: SceneOp): OpResult {
  switch (op.op) {
    case "create": {
      const id = op.element.id;
      if (doc.elements[id]) return { ok: false, error: `Element "${id}" already exists` };
      const checked = validate(op.element, id, doc);
      if (!checked.ok) return checked;
      return {
        ok: true,
        doc: { ...doc, elements: { ...doc.elements, [id]: checked.element } },
        inverse: { op: "delete", id },
      };
    }
    case "update": {
      const current = doc.elements[op.id];
      if (!current) return { ok: false, error: `Element "${op.id}" does not exist` };
      // id and type are fixed for the life of an element; a null value removes an optional field.
      const merged: Record<string, unknown> = { ...current };
      for (const [key, value] of Object.entries(op.patch)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      merged.id = current.id;
      merged.type = current.type;
      const checked = validate(merged, op.id, doc);
      if (!checked.ok) return checked;
      const previous: Record<string, unknown> = {};
      for (const key of Object.keys(op.patch)) {
        if (key === "id" || key === "type") continue;
        // Absent fields come back as null so the inverse removes them (undefined would not survive JSON).
        previous[key] = (current as Record<string, unknown>)[key] ?? null;
      }
      return {
        ok: true,
        doc: { ...doc, elements: { ...doc.elements, [op.id]: checked.element } },
        inverse: { op: "update", id: op.id, patch: previous },
      };
    }
    case "delete": {
      const current = doc.elements[op.id];
      if (!current) return { ok: false, error: `Element "${op.id}" does not exist` };
      const { [op.id]: _removed, ...rest } = doc.elements;
      return { ok: true, doc: { ...doc, elements: rest }, inverse: { op: "create", element: current } };
    }
  }
}

/** Applies operations in order, atomically: if any fails, nothing changes. The inverse list undoes them all. */
export function applyTransaction(doc: SceneDocument, ops: SceneOp[]): TransactionResult {
  let current = doc;
  const inverse: SceneOp[] = [];
  for (const op of ops) {
    const result = applyOp(current, op);
    if (!result.ok) return result;
    current = result.doc;
    inverse.unshift(result.inverse);
  }
  return { ok: true, doc: current, inverse };
}
