import {
  MAX_REQUEST_REFERENCES,
  MAX_REQUEST_SELECTION,
  type RequestContext,
  type SceneDocument,
  type SceneOp,
} from "@hai/protocol";
import { elementBounds, expandToGroups, groupOps, newGroupId, soleGroup, unionBounds } from "@hai/scene";

/**
 * What a request about several elements needs so that an agent treats them as one object: the elements made one group
 * (`ops`, none when they are one already) and the group named in the context. A request about one element, or none,
 * goes as it is. A group can be larger than a request can list, so the lists are cut and the group stands for all of it.
 */
export function groupForRequest(
  doc: SceneDocument | null,
  context: RequestContext | undefined,
  selection: string[],
): { context: RequestContext | undefined; ops: SceneOp[] } {
  if (!doc) return { context, ops: [] };
  const named = context?.references.length ? context.references.map((reference) => reference.id) : selection;
  const ids = expandToGroups(doc, named).filter((id) => doc.elements[id]);
  if (ids.length < 2) return { context, ops: [] };
  const box = unionBounds(
    ids.flatMap((id) => (doc.elements[id] ? [elementBounds(doc.elements[id], doc.levels)] : [])),
  );
  if (!box) return { context, ops: [] };
  const existing = soleGroup(doc, ids);
  const group = existing ?? newGroupId();
  const base = context ?? { references: [], selection, groundPoint: null };
  return {
    context: {
      ...base,
      references: base.references.slice(0, MAX_REQUEST_REFERENCES),
      selection: base.selection.slice(0, MAX_REQUEST_SELECTION),
      group: {
        id: group,
        count: ids.length,
        centre: [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2],
      },
    },
    ops: existing ? [] : groupOps(doc, ids, group),
  };
}
