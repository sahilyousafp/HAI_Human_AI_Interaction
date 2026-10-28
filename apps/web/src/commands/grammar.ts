import type { ElementType, Point3Mm } from "@hai/protocol";
import { readLength, readNumber } from "./numbers.ts";

/** Which elements a command names: all of them, none, one type ("all walls") or a level ("level 2"). */
export type Selector =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "type"; type: ElementType }
  | { kind: "level"; name: string };

/** One thing the user said to do. Distances are millimetres and angles degrees, counter-clockwise from above. */
export type Clause =
  | { kind: "translate"; by: Point3Mm }
  /** `count` copies, each `by` further along than the one before (in place when `by` is null); what follows acts on the copies. */
  | { kind: "copy"; count: number; by: Point3Mm | null }
  | { kind: "rotate"; deg: number }
  | { kind: "scale"; factor: number }
  | { kind: "mirror"; axis: "x" | "y" }
  | { kind: "select"; selector: Selector }
  | { kind: "delete" | "hide" | "isolate"; selector: Selector | null }
  | { kind: "showAll" };

/** What a whole transcript says: its clauses, in the order they run. */
export interface Command {
  clauses: Clause[];
}

/** The most copies one command may make. */
export const MAX_COPIES = 200;

/** A transcript as lower-case words: units and numbers apart, punctuation gone, commas as "and". */
export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/°/g, " degrees ")
    .replace(/%/g, " percent ")
    .replace(/[,;]/g, " and ")
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([a-z])-([a-z])/g, "$1 $2")
    .replace(/\.(\s|$)/g, " ")
    .replace(/[^a-z0-9.\- ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Words that open a request without changing it: "please move this". */
const POLITE = new Set(["please", "now", "just", "ok", "okay", "can", "could", "would", "you"]);
/** Words inside a clause that carry nothing the grammar needs: "move it by 3 metres along the x axis". */
const FILLER = new Set([
  "the",
  "a",
  "an",
  "to",
  "by",
  "along",
  "in",
  "on",
  "of",
  "for",
  "with",
  "direction",
  "axis",
  "degree",
  "degrees",
  "deg",
  "this",
  "these",
  "it",
  "them",
  "selection",
  "selected",
  "please",
]);
const SEPARATORS = new Set(["and", "then", "next"]);

const VERBS: Record<string, string> = {
  move: "move",
  shift: "move",
  copy: "copy",
  duplicate: "copy",
  clone: "copy",
  rotate: "rotate",
  turn: "rotate",
  scale: "scale",
  resize: "scale",
  mirror: "mirror",
  flip: "mirror",
  select: "select",
  deselect: "deselect",
  unselect: "deselect",
  clear: "deselect",
  delete: "delete",
  erase: "delete",
  remove: "delete",
  hide: "hide",
  isolate: "isolate",
  show: "show",
  unhide: "show",
};

type Axis = { axis: 0 | 1 | 2; sign: 1 | -1 };
/** Directions, with north as +Y (the top of the plan) and east as +X. */
const AXES: Record<string, Axis> = {
  x: { axis: 0, sign: 1 },
  y: { axis: 1, sign: 1 },
  z: { axis: 2, sign: 1 },
  east: { axis: 0, sign: 1 },
  west: { axis: 0, sign: -1 },
  north: { axis: 1, sign: 1 },
  south: { axis: 1, sign: -1 },
  up: { axis: 2, sign: 1 },
  down: { axis: 2, sign: -1 },
};

const TYPE_WORDS: Record<string, ElementType> = {
  wall: "wall",
  walls: "wall",
  column: "column",
  columns: "column",
  slab: "slab",
  slabs: "slab",
  floor: "slab",
  floors: "slab",
  massing: "massing",
  massings: "massing",
  mass: "massing",
  masses: "massing",
  block: "massing",
  blocks: "massing",
  line: "line",
  lines: "line",
  polyline: "line",
  polylines: "line",
  model: "imported",
  models: "imported",
  imported: "imported",
  import: "imported",
  imports: "imported",
};

/** Distances along axes ("3 m east", "up 2000", "2 m x and 1 m y") added into one offset, or null if anything else is there. */
function readOffset(words: string[]): Point3Mm | null {
  const by: Point3Mm = [0, 0, 0];
  let axis: Axis | null = null;
  let amount: number | null = null;
  let applied = 0;
  const apply = (a: Axis, mm: number) => {
    by[a.axis] += a.sign * mm;
    applied++;
  };
  for (let i = 0; i < words.length; ) {
    const direction = AXES[words[i] as string];
    if (direction) {
      if (axis) return null;
      if (amount === null) axis = direction;
      else {
        apply(direction, amount);
        amount = null;
      }
      i++;
      continue;
    }
    const length = readLength(words, i);
    if (!length || amount !== null) return null;
    if (axis) {
      apply(axis, length.value);
      axis = null;
    } else amount = length.value;
    i = length.next;
  }
  return axis || amount !== null || applied === 0 ? null : by;
}

/** Which elements the words after select, delete, hide or isolate name; null when they are something else. */
function readSelector(words: string[]): { selector: Selector | null } | null {
  if (words.length === 0) return { selector: null };
  const [first, ...rest] = words;
  if (words.length === 1 && (first === "all" || first === "everything")) return { selector: { kind: "all" } };
  if (words.length === 1 && (first === "none" || first === "nothing")) return { selector: { kind: "none" } };
  if (first === "level" && rest.length > 0) {
    const number = readNumber(rest, 0);
    const named = number && number.next === rest.length ? `level ${number.value}` : rest.join(" ");
    return { selector: { kind: "level", name: named } };
  }
  const type = TYPE_WORDS[(first === "all" ? rest[0] : first) as string];
  const typeWords = first === "all" ? rest : words;
  return type && typeWords.length === 1 ? { selector: { kind: "type", type } } : null;
}

const COUNT_WORDS = new Set(["times", "time", "copies", "copy"]);

function parseCopy(args: string[]): Clause | null {
  let count = 1;
  let from = 0;
  const number = readNumber(args, 0);
  if (number && COUNT_WORDS.has(args[number.next] ?? "")) {
    count = number.value;
    from = number.next + 1;
  } else if (args[0] === "twice") {
    count = 2;
    from = 1;
  } else if (args[0] === "once") from = 1;
  if (!Number.isInteger(count) || count < 1 || count > MAX_COPIES) return null;
  const rest = args.slice(from);
  if (rest.length === 0) return { kind: "copy", count, by: null };
  const by = readOffset(rest);
  return by ? { kind: "copy", count, by } : null;
}

function parseRotate(args: string[]): Clause | null {
  const anti = args.some((w) => w === "anticlockwise" || w === "counterclockwise" || w === "counter");
  const clockwise = !anti && args.includes("clockwise");
  const rest = args.filter(
    (w) => w !== "anticlockwise" && w !== "counterclockwise" && w !== "counter" && w !== "clockwise",
  );
  const number = readNumber(rest, 0);
  if (!number || number.next !== rest.length || number.value === 0) return null;
  return { kind: "rotate", deg: clockwise ? -number.value : number.value };
}

function parseScale(args: string[]): Clause | null {
  const keyword: Record<string, number> = { double: 2, triple: 3 };
  const named = keyword[args[0] ?? ""];
  if (args.length === 1 && named !== undefined) return { kind: "scale", factor: named };
  const number = readNumber(args, 0);
  if (!number) return null;
  const tail = args.slice(number.next);
  let factor = number.value;
  if (tail.length === 1 && tail[0] === "percent") factor /= 100;
  else if (!(tail.length === 0 || (tail.length === 1 && tail[0] === "times"))) return null;
  return factor > 0 && factor !== 1 ? { kind: "scale", factor } : null;
}

function parseMirror(args: string[]): Clause | null {
  const direction = args.length === 1 ? AXES[args[0] as string] : undefined;
  if (!direction || direction.axis === 2) return null;
  return { kind: "mirror", axis: direction.axis === 0 ? "x" : "y" };
}

function parseClause(verb: string, args: string[]): Clause | null {
  switch (verb) {
    case "move": {
      const by = readOffset(args);
      return by ? { kind: "translate", by } : null;
    }
    case "copy":
      return parseCopy(args);
    case "rotate":
      return parseRotate(args);
    case "scale":
      return parseScale(args);
    case "mirror":
      return parseMirror(args);
    case "deselect":
      return args.length === 0 ? { kind: "select", selector: { kind: "none" } } : null;
    case "show":
      return args.length === 0 || (args.length === 1 && (args[0] === "all" || args[0] === "everything"))
        ? { kind: "showAll" }
        : null;
    case "select": {
      const read = readSelector(args);
      return read?.selector ? { kind: "select", selector: read.selector } : null;
    }
    case "delete":
    case "hide":
    case "isolate": {
      const read = readSelector(args);
      if (!read) return null;
      // "remove the wall" is not "remove every wall": a whole type is only named with "all".
      if (read.selector?.kind === "type" && args[0] !== "all") return null;
      return { kind: verb, selector: read.selector };
    }
  }
  return null;
}

/** Whether a sequence of clauses can run together: an optional select, then changes of place or one final action. */
function validSequence(clauses: Clause[]): boolean {
  const [first] = clauses;
  const rest = first?.kind === "select" ? clauses.slice(1) : clauses;
  if (rest.length === 0) return clauses.length > 0;
  const actions = rest.filter(
    (c) => c.kind === "delete" || c.kind === "hide" || c.kind === "isolate" || c.kind === "showAll",
  );
  if (actions.length > 0) {
    const only = rest.length === 1;
    const action = rest[0] as Clause;
    // A named selector in the action and a select before it would both say what to act on.
    const doubled = clauses.length === 2 && "selector" in action && action.selector !== null;
    return only && !doubled;
  }
  if (rest.some((c) => c.kind === "select")) return false;
  return rest.filter((c) => c.kind === "copy").length <= 1;
}

/**
 * The command a transcript is, or null. Everything said must be understood: one word the grammar does not know and the
 * transcript is the agent's. Clauses are joined by "and", "then" or a comma ("copy and rotate 90"); a clause that is
 * only a distance goes on the move or copy before it ("move 2 m up and 3 m east").
 */
export function parseCommand(text: string): Command | null {
  const words = wordsOf(text);
  while (POLITE.has(words[0] ?? "")) words.shift();
  while (POLITE.has(words[words.length - 1] ?? "")) words.pop();
  if (words.length === 0) return null;

  const parts: string[][] = [[]];
  for (const word of words) {
    if (SEPARATORS.has(word)) parts.push([]);
    else (parts[parts.length - 1] as string[]).push(word);
  }

  const clauses: Clause[] = [];
  for (const part of parts) {
    // "and then" leaves nothing between the two.
    if (part.length === 0) continue;
    const [head, ...tail] = part;
    const verb = head === undefined ? undefined : VERBS[head];
    const args = tail.filter((w) => !FILLER.has(w));
    if (verb) {
      const clause = parseClause(verb, args);
      if (!clause) return null;
      clauses.push(clause);
      continue;
    }
    // No verb: more distance for the move or copy before.
    const previous = clauses[clauses.length - 1];
    const more = readOffset(part.filter((w) => !FILLER.has(w)));
    if (!more || !previous || (previous.kind !== "translate" && previous.kind !== "copy")) return null;
    const by = previous.kind === "copy" && previous.by === null ? ([0, 0, 0] as Point3Mm) : previous.by;
    if (!by) return null;
    previous.by = [by[0] + more[0], by[1] + more[1], by[2] + more[2]];
  }
  return validSequence(clauses) ? { clauses } : null;
}
