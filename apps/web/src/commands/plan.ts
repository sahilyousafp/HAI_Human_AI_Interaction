import type { Element, Point3Mm, SceneDocument, SceneOp } from "@hai/protocol";
import { applySteps, type TransformStep } from "@hai/scene";
import { newId } from "../tools/create.ts";
import type { Clause, Command, Selector } from "./grammar.ts";

/** What a command comes to once it is checked against the model, before anything is changed. */
export type Plan =
  /** Scene changes as one undo step; `select` is the selection afterwards (null leaves it as it is). */
  | { kind: "edit"; label: string; ops: SceneOp[]; select: string[] | null }
  | { kind: "select"; label: string; ids: string[] }
  /** Asked first: a nod or Enter deletes. */
  | { kind: "delete"; label: string; ids: string[] }
  | { kind: "hide" | "isolate"; label: string; ids: string[] }
  | { kind: "showAll"; label: string }
  | { kind: "error"; message: string };

/** The most elements one command may create. */
export const MAX_NEW_ELEMENTS = 500;

const NOTHING_TO_ACT_ON = "Select something first.";

/** A length in millimetres as it is said: "3 m", "30 cm", "250 mm". */
export function lengthText(mm: number): string {
  const abs = Math.abs(mm);
  if (abs >= 1000 && abs % 1000 === 0) return `${abs / 1000} m`;
  if (abs >= 10 && abs % 10 === 0 && abs < 1000) return `${abs / 10} cm`;
  return abs >= 1000 ? `${Math.round(abs) / 1000} m` : `${Math.round(abs * 10) / 10} mm`;
}

const DIRECTIONS: Array<[negative: string, positive: string]> = [
  ["west", "east"],
  ["south", "north"],
  ["down", "up"],
];

/** An offset as it is said: "3 m east and 2 m up". */
function offsetText(by: Point3Mm): string {
  return by
    .flatMap((mm, axis) => {
      if (mm === 0) return [];
      const [negative, positive] = DIRECTIONS[axis] as [string, string];
      return [`${lengthText(mm)} ${mm < 0 ? negative : positive}`];
    })
    .join(" and ");
}

function selectorText(selector: Selector): string {
  switch (selector.kind) {
    case "all":
      return "all";
    case "none":
      return "nothing";
    case "type":
      return `all ${selector.type === "imported" ? "imported models" : `${selector.type}s`}`;
    case "level":
      return selector.name;
  }
}

function clauseText(clause: Clause): string {
  switch (clause.kind) {
    case "translate":
      return `move ${offsetText(clause.by)}`;
    case "copy": {
      const times = clause.count > 1 ? ` ${clause.count} times` : "";
      return `copy${times}${clause.by ? ` ${offsetText(clause.by)}` : ""}`;
    }
    case "rotate":
      return `rotate ${clause.deg}°`;
    case "scale":
      return `scale ${clause.factor}`;
    case "mirror":
      return `mirror ${clause.axis}`;
    case "select":
      return clause.selector.kind === "none"
        ? "clear the selection"
        : `select ${selectorText(clause.selector)}`;
    case "delete":
    case "hide":
    case "isolate":
      return clause.kind;
    case "showAll":
      return "show all";
  }
}

/** What a command says in a few words, for the undo step and the chip: "Copy, rotate 90°". */
export function commandLabel(clauses: Clause[]): string {
  const text = clauses.map(clauseText).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

function resolveSelector(selector: Selector, doc: SceneDocument): { ids: string[] } | { error: string } {
  const all = Object.values(doc.elements);
  switch (selector.kind) {
    case "none":
      return { ids: [] };
    case "all":
      return all.length > 0 ? { ids: all.map((e) => e.id) } : { error: "There is nothing in the model." };
    case "type": {
      const ids = all.filter((e) => e.type === selector.type).map((e) => e.id);
      return ids.length > 0
        ? { ids }
        : { error: `There is no ${selectorText(selector).replace("all ", "")}.` };
    }
    case "level": {
      const level = doc.levels.find((l) => norm(l.name) === selector.name);
      if (!level) return { error: `There is no ${selector.name}.` };
      const ids = all.filter((e) => e.level === level.id).map((e) => e.id);
      return ids.length > 0 ? { ids } : { error: `Nothing is on ${level.name}.` };
    }
  }
}

function stepsOf(clauses: Clause[]): TransformStep[] {
  return clauses.flatMap((clause): TransformStep[] => {
    switch (clause.kind) {
      case "translate":
        return [{ kind: "translate", by: clause.by }];
      case "rotate":
        return [{ kind: "rotate", deg: clause.deg }];
      case "scale":
        return [{ kind: "scale", factor: clause.factor }];
      case "mirror":
        return [{ kind: "mirror", axis: clause.axis }];
      default:
        return [];
    }
  });
}

const namesOf = (doc: SceneDocument, ids: string[]) =>
  ids.length === 1 ? (doc.elements[ids[0] as string] as Element).name : `${ids.length} elements`;

/** The changes of place a command asks for, as `update` ops, and `create` ops for the copies. */
function planEdit(clauses: Clause[], doc: SceneDocument, ids: string[], label: string): Plan {
  const elements = ids.map((id) => doc.elements[id] as Element);
  const copyAt = clauses.findIndex((c) => c.kind === "copy");
  if (copyAt < 0) {
    const done = applySteps(elements, stepsOf(clauses), doc.levels);
    if (!done.ok) return { kind: "error", message: done.error };
    const ops = Object.entries(done.patches).map(([id, patch]): SceneOp => ({ op: "update", id, patch }));
    return { kind: "edit", label, ops, select: null };
  }

  // What comes before the copy moves the originals; what follows (and the copy's own offset) makes the copies.
  const copy = clauses[copyAt] as Extract<Clause, { kind: "copy" }>;
  if (elements.length * copy.count > MAX_NEW_ELEMENTS) {
    return { kind: "error", message: `That makes more than ${MAX_NEW_ELEMENTS} copies.` };
  }
  const ops: SceneOp[] = [];
  let working = elements;
  const before = stepsOf(clauses.slice(0, copyAt));
  if (before.length > 0) {
    const moved = applySteps(elements, before, doc.levels);
    if (!moved.ok) return { kind: "error", message: moved.error };
    for (const [id, patch] of Object.entries(moved.patches)) ops.push({ op: "update", id, patch });
    working = elements.map((e) => ({ ...e, ...moved.patches[e.id] }) as Element);
  }
  const unit: TransformStep[] = copy.by ? [{ kind: "translate", by: copy.by }] : [];
  const after = stepsOf(clauses.slice(copyAt + 1));
  const created: string[] = [];
  for (let i = 1; i <= copy.count; i++) {
    const steps = [...Array.from({ length: i }, () => unit).flat(), ...after];
    const done = applySteps(working, steps, doc.levels);
    if (!done.ok) return { kind: "error", message: done.error };
    for (const element of working) {
      const id = newId(element.type);
      created.push(id);
      ops.push({
        op: "create",
        element: {
          ...element,
          ...done.patches[element.id],
          id,
          name: copy.count > 1 ? `${element.name} copy ${i}` : `${element.name} copy`,
        } as Element,
      });
    }
  }
  return { kind: "edit", label, ops, select: created };
}

/**
 * Checks a command against the model: what it acts on (`thisIds`: what the user pointed at or has selected, unless the
 * command names its own with a leading select) and what it comes to. Nothing is changed here.
 */
export function planCommand(command: Command, doc: SceneDocument, thisIds: string[]): Plan {
  const label = commandLabel(command.clauses);
  let rest = command.clauses;
  let ids = thisIds.filter((id) => doc.elements[id]);

  const [first] = command.clauses;
  if (first?.kind === "select") {
    const found = resolveSelector(first.selector, doc);
    if ("error" in found) return { kind: "error", message: found.error };
    rest = command.clauses.slice(1);
    ids = found.ids;
    if (rest.length === 0) return { kind: "select", label, ids };
  }

  const [action] = rest;
  if (action && "selector" in action && action.selector) {
    const found = resolveSelector(action.selector, doc);
    if ("error" in found) return { kind: "error", message: found.error };
    ids = found.ids;
  }
  if (action?.kind === "showAll") return { kind: "showAll", label };
  if (ids.length === 0) return { kind: "error", message: NOTHING_TO_ACT_ON };

  switch (action?.kind) {
    case "delete":
      return { kind: "delete", label: `Delete ${namesOf(doc, ids)}`, ids };
    case "hide":
    case "isolate":
      return { kind: action.kind, label, ids };
    default: {
      const planned = planEdit(rest, doc, ids, label);
      // A leading select also leaves the selection on what the command acted on.
      return first?.kind === "select" && planned.kind === "edit" && planned.select === null
        ? { ...planned, select: ids }
        : planned;
    }
  }
}
