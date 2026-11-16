import {
  type Element,
  HOST_INFO,
  type HostEditOp,
  type HostId,
  type LetterMarker,
  type Point3Mm,
  type SceneDocument,
  type SceneOp,
} from "@hai/protocol";
import {
  applySteps,
  groupOf,
  groupOps,
  newGroupId,
  soleGroup,
  type TransformStep,
  ungroupOps,
} from "@hai/scene";
import {
  boxOfObjects,
  describeObjects,
  type HostTargets,
  mirrorAcross,
  multiply,
  rotationAbout,
  transformPoint,
  translation,
} from "../tools/host-targets.ts";
import type { Clause, Command, RemovedVerb, Selector } from "./grammar.ts";

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

/** What a command comes to on a host's objects: one edit sent to the host, a delete asked first, or why not. */
export type HostPlan =
  | { kind: "hostEdit"; host: HostId; label: string; op: HostEditOp }
  | { kind: "hostDelete"; host: HostId; label: string; ids: string[] }
  | { kind: "error"; message: string };

/** What the reply says to a command that made geometry: the agent has the host make it. */
export const REMOVED_COMMAND: Record<RemovedVerb, string> = {
  copy: "HAI does not copy any more. Ask the agent, and it makes the copies in the host.",
  array: "HAI does not make arrays any more. Ask the agent, and it makes the array in the host.",
  scale: "HAI does not scale any more. Ask the agent, and it scales it in the host.",
};

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

const aboutText = (marker: string | undefined) => (marker ? ` about marker ${marker}` : "");

function clauseText(clause: Clause): string {
  switch (clause.kind) {
    case "translate":
      return `move ${offsetText(clause.by)}`;
    case "moveTo":
      return `move to marker ${clause.marker}`;
    case "rotate":
      return `rotate ${clause.deg}°${aboutText(clause.about)}`;
    case "mirror":
      return `mirror ${clause.axis}${aboutText(clause.about)}`;
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
    case "group":
    case "ungroup":
      return clause.kind;
    case "removed":
      return clause.what;
  }
}

/** What a command says in a few words, for the undo step and the chip: "Move 2 m east, rotate 90°". */
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

/** The marker a clause names, as a pivot or as a place to move to. */
function markerOf(clause: Clause): string | undefined {
  switch (clause.kind) {
    case "moveTo":
      return clause.marker;
    case "rotate":
    case "mirror":
      return clause.about;
    default:
      return undefined;
  }
}

/** The steps a run of clauses comes to, or what is wrong with them (a marker that is not placed). */
function stepsOf(clauses: Clause[], markers: LetterMarker[]): TransformStep[] | string {
  const steps: TransformStep[] = [];
  for (const clause of clauses) {
    const marker = markerOf(clause);
    const point = marker ? markers.find((m) => m.letter === marker)?.point : undefined;
    if (marker && !point) return `There is no marker ${marker}.`;
    switch (clause.kind) {
      case "translate":
        steps.push({ kind: "translate", by: clause.by });
        break;
      case "moveTo":
        steps.push({ kind: "moveTo", to: point as Point3Mm });
        break;
      case "rotate":
        steps.push({ kind: "rotate", deg: clause.deg, ...(point ? { about: [point[0], point[1]] } : {}) });
        break;
      case "mirror":
        steps.push({
          kind: "mirror",
          axis: clause.axis,
          ...(point ? { at: point[clause.axis === "x" ? 0 : 1] } : {}),
        });
        break;
    }
  }
  return steps;
}

const namesOf = (doc: SceneDocument, ids: string[]) =>
  ids.length === 1 ? (doc.elements[ids[0] as string] as Element).name : `${ids.length} elements`;

/** The changes of place a command asks for, as `update` ops. */
function planEdit(
  clauses: Clause[],
  doc: SceneDocument,
  ids: string[],
  label: string,
  markers: LetterMarker[],
): Plan {
  const elements = ids.map((id) => doc.elements[id] as Element);
  const steps = stepsOf(clauses, markers);
  if (typeof steps === "string") return { kind: "error", message: steps };
  const done = applySteps(elements, steps, doc.levels);
  if (!done.ok) return { kind: "error", message: done.error };
  const ops = Object.entries(done.patches).map(([id, patch]): SceneOp => ({ op: "update", id, patch }));
  return { kind: "edit", label, ops, select: null };
}

/**
 * Checks a command against the model: what it acts on (`thisIds`: what the user pointed at or has selected, unless the
 * command names its own with a leading select) and what it comes to. Nothing is changed here.
 */
export function planCommand(
  command: Command,
  doc: SceneDocument,
  thisIds: string[],
  markers: LetterMarker[] = [],
): Plan {
  const label = commandLabel(command.clauses);
  const removed = command.clauses.find((c) => c.kind === "removed");
  if (removed?.kind === "removed") return { kind: "error", message: REMOVED_COMMAND[removed.what] };
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
    case "group":
      if (ids.length < 2) return { kind: "error", message: "Select at least two elements to group." };
      if (soleGroup(doc, ids)) return { kind: "error", message: "That is a group already." };
      return { kind: "edit", label, ops: groupOps(doc, ids, newGroupId()), select: ids };
    case "ungroup":
      if (!ids.some((id) => groupOf(doc.elements[id])))
        return { kind: "error", message: "That is not a group." };
      return { kind: "edit", label, ops: ungroupOps(doc, ids), select: ids };
    default: {
      const planned = planEdit(rest, doc, ids, label, markers);
      // A leading select also leaves the selection on what the command acted on.
      return first?.kind === "select" && planned.kind === "edit" && planned.select === null
        ? { ...planned, select: ids }
        : planned;
    }
  }
}

/**
 * A command on a host's objects (what is selected in Rhino, Blender or Revit): moves, turns and mirrors come to one
 * matrix, sent to the host as one edit and one undo step there; a delete is asked first. What only HAI's elements have
 * (hide, isolate, groups) says so. A move to a marker takes the middle of the objects' footprint there, at their height.
 */
export function planHostCommand(
  command: Command,
  targets: HostTargets,
  markers: LetterMarker[] = [],
): HostPlan {
  const removed = command.clauses.find((c) => c.kind === "removed");
  if (removed?.kind === "removed") return { kind: "error", message: REMOVED_COMMAND[removed.what] };
  const { host, objects } = targets;
  const ids = objects.map((o) => o.id);
  const what = describeObjects(objects);
  const [only] = command.clauses;
  if (command.clauses.length === 1 && only?.kind === "delete" && only.selector === null)
    return { kind: "hostDelete", host, label: `Delete ${what}`, ids };
  const { min, max } = boxOfObjects(objects);
  // The middle of the footprint, at the base: what a turn or a mirror goes about, followed through each step.
  let centre: Point3Mm = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
  let matrix = translation(0, 0, 0);
  for (const clause of command.clauses) {
    const marker = markerOf(clause);
    const point = marker ? markers.find((m) => m.letter === marker)?.point : undefined;
    if (marker && !point) return { kind: "error", message: `There is no marker ${marker}.` };
    let step: number[];
    switch (clause.kind) {
      case "translate":
        step = translation(clause.by[0], clause.by[1], clause.by[2]);
        break;
      case "moveTo":
        step = translation((point as Point3Mm)[0] - centre[0], (point as Point3Mm)[1] - centre[1], 0);
        break;
      case "rotate": {
        const about: [number, number] = point ? [point[0], point[1]] : [centre[0], centre[1]];
        step = rotationAbout(clause.deg, about);
        break;
      }
      case "mirror": {
        const axis = clause.axis === "x" ? 0 : 1;
        step = mirrorAcross(axis, point ? point[axis] : centre[axis]);
        break;
      }
      default:
        return {
          kind: "error",
          message: `That works on HAI's own elements. Ask the agent to do it in ${HOST_INFO[host].label}.`,
        };
    }
    matrix = multiply(step, matrix);
    centre = transformPoint(step, centre);
  }
  return {
    kind: "hostEdit",
    host,
    label: commandLabel(command.clauses).replace(/^(\w+)/, (verb) => `${verb} ${what}`),
    op: { op: "transform", ids, matrix },
  };
}
