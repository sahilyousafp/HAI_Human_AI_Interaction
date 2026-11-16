import type { ElementType, Point3Mm } from "@hai/protocol";
import { NUMBER_WORDS, readLength, readNumber, UNIT_WORDS } from "./numbers.ts";

/** Which elements a command names: all of them, none, one type ("all walls") or a level ("level 2"). */
export type Selector =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "type"; type: ElementType }
  | { kind: "level"; name: string };

/** One thing the user said to do. Distances are millimetres and angles degrees, counter-clockwise from above. */
export type Clause =
  | { kind: "translate"; by: Point3Mm }
  /** Takes what is acted on to a lettered marker ("move to marker A"). */
  | { kind: "moveTo"; marker: string }
  | { kind: "rotate"; deg: number; about?: string }
  | { kind: "mirror"; axis: "x" | "y"; about?: string }
  /**
   * A command HAI no longer has, because it made geometry ("copy", "array", "scale"): heard, so that the reply can say
   * to ask the agent, and nothing is changed.
   */
  | { kind: "removed"; what: RemovedVerb }
  | { kind: "select"; selector: Selector }
  | { kind: "delete" | "hide" | "isolate"; selector: Selector | null }
  | { kind: "showAll" }
  | { kind: "group" | "ungroup" };

/** The commands that made geometry, gone with the creation tools: the hosts model, through the agent. */
export type RemovedVerb = "copy" | "array" | "scale";
const REMOVED_VERBS: ReadonlySet<string> = new Set<RemovedVerb>(["copy", "array", "scale"]);

/** What a whole transcript says: its clauses, in the order they run. */
export interface Command {
  clauses: Clause[];
}

/** A transcript as lower-case words: units and numbers apart, punctuation gone, commas as "and". */
export function wordsOf(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/['’]/g, "") // "let's" is "lets" and "don't" is "dont", not words with an s or a t left over
      .replace(/\bmake an? copy\b/g, "copy") // "make a copy" is "copy"
      // "and" inside a number is not a clause break: "one hundred and eighty", "two and a half".
      .replace(
        /\b(hundred|thousand) and (?=(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b)/g,
        "$1 ",
      )
      .replace(
        /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) and a half\b/g,
        "$1 point five",
      )
      .replace(/°/g, " degrees ")
      .replace(/%/g, " percent ")
      .replace(/[,;]/g, " and ")
      .replace(/([0-9])([a-z])/g, "$1 $2")
      .replace(/([a-z])([0-9])/g, "$1 $2")
      .replace(/([a-z])-([a-z])/g, "$1 $2")
      .replace(/\.(\s|$)/g, " ")
      .replace(/[^a-z0-9.\- ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

/** Words that open or close a request without changing it: "please move this", "move this, thanks". */
const POLITE = new Set([
  "please",
  "now",
  "just",
  "ok",
  "okay",
  "can",
  "could",
  "would",
  "you",
  "thanks",
  "thank",
]);
/**
 * Words that lead into a clause the way people talk ("I want to move this", "go ahead and copy it", "let's rotate it"),
 * on top of `POLITE`. They are only dropped at the start of a clause, so none of them can change what a command does;
 * a word that would ("not", "don't", "never", "stop") is not here, and with one in it the transcript is the agent's.
 */
const LEADING = new Set([
  ...POLITE,
  ...[
    "i",
    "id",
    "ill",
    "im",
    "we",
    "want",
    "wanna",
    "need",
    "like",
    "will",
    "let",
    "lets",
    "kindly",
    "go",
    "ahead",
    "to",
  ],
  ...["um", "uh", "er", "so", "well", "actually", "maybe", "hey"],
]);
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
  "towards",
  "toward",
  "into",
  "side",
  "me",
  "my",
  "again",
]);
const SEPARATORS = new Set(["and", "then", "next"]);

const VERBS: Record<string, string> = {
  move: "move",
  shift: "move",
  slide: "move",
  push: "move",
  nudge: "move",
  relocate: "move",
  copy: "copy",
  duplicate: "copy",
  clone: "copy",
  array: "array",
  rotate: "rotate",
  turn: "rotate",
  spin: "rotate",
  scale: "scale",
  resize: "scale",
  enlarge: "scale",
  shrink: "scale",
  mirror: "mirror",
  flip: "mirror",
  select: "select",
  choose: "select",
  pick: "select",
  deselect: "deselect",
  unselect: "deselect",
  clear: "deselect",
  delete: "delete",
  erase: "delete",
  remove: "delete",
  hide: "hide",
  conceal: "hide",
  isolate: "isolate",
  group: "group",
  ungroup: "ungroup",
  show: "show",
  unhide: "show",
  reveal: "show",
};

export type Axis = { axis: 0 | 1 | 2; sign: 1 | -1 };
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
  upward: { axis: 2, sign: 1 },
  upwards: { axis: 2, sign: 1 },
  downward: { axis: 2, sign: -1 },
  downwards: { axis: 2, sign: -1 },
  // As people say them in front of a plan with north at the top; the view is not asked.
  right: { axis: 0, sign: 1 },
  left: { axis: 0, sign: -1 },
  forward: { axis: 1, sign: 1 },
  forwards: { axis: 1, sign: 1 },
  back: { axis: 1, sign: -1 },
  backward: { axis: 1, sign: -1 },
  backwards: { axis: 1, sign: -1 },
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

/** The three axis letters: they name an axis and say nothing of which way along it. */
const AXIS_LETTERS = new Set(["x", "y", "z"]);

/**
 * Distances along axes ("3 m east", "up 2000", "2 m x and 1 m y") added into one offset, or null if anything else is
 * there. An axis letter and a way along it may both be said, in either order ("5 m y towards right", "5 m right along
 * y"): the letter gives the axis and the word the way (right, forward and up are plus; left, back and down minus).
 */
function readOffset(words: string[]): Point3Mm | null {
  const by: Point3Mm = [0, 0, 0];
  let axis: Axis | null = null;
  /** Whether the axis waiting for its distance came from a letter or from a word that says the way. */
  let axisFromLetter = false;
  let amount: number | null = null;
  let applied = 0;
  /** The distance applied last, with how its axis was named, so a later word can still say the way or the axis. */
  let last: { a: Axis; mm: number; fromLetter: boolean } | null = null;
  const apply = (a: Axis, mm: number, fromLetter: boolean) => {
    by[a.axis] += a.sign * mm;
    applied++;
    last = { a, mm, fromLetter };
  };
  for (let i = 0; i < words.length; ) {
    const word = words[i] as string;
    const direction = AXES[word];
    if (direction) {
      const fromLetter = AXIS_LETTERS.has(word);
      if (axis) {
        // "y" then "right" (or "right" then "y") before the distance: the letter's axis, the word's way.
        if (fromLetter === axisFromLetter) return null;
        axis = {
          axis: fromLetter ? direction.axis : axis.axis,
          sign: fromLetter ? axis.sign : direction.sign,
        };
        axisFromLetter = true;
      } else if (amount === null) {
        const before = last as { a: Axis; mm: number; fromLetter: boolean } | null;
        if (before && before.fromLetter !== fromLetter) {
          // The distance was given first and the axis and its way come in two words: put it right.
          by[before.a.axis] -= before.a.sign * before.mm;
          const merged: Axis = {
            axis: fromLetter ? direction.axis : before.a.axis,
            sign: fromLetter ? before.a.sign : direction.sign,
          };
          by[merged.axis] += merged.sign * before.mm;
          last = { a: merged, mm: before.mm, fromLetter: true };
        } else {
          axis = direction;
          axisFromLetter = fromLetter;
        }
      } else {
        apply(direction, amount, fromLetter);
        amount = null;
      }
      i++;
      continue;
    }
    const length = readLength(words, i);
    if (!length || amount !== null) return null;
    if (axis) {
      apply(axis, length.value, axisFromLetter);
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

/**
 * Every word the grammar reads: the reference set for putting a mishearing right (voice/lexicon.ts). Words it only
 * uses inside a rule (a marker's letter, a level's name) are not here; they are what the speaker said.
 */
export const COMMAND_VOCABULARY: ReadonlySet<string> = new Set([
  ...Object.keys(VERBS),
  ...Object.keys(AXES),
  ...Object.keys(TYPE_WORDS),
  ...POLITE,
  ...FILLER,
  ...SEPARATORS,
  ...NUMBER_WORDS,
  ...UNIT_WORDS,
  ...["all", "everything", "none", "nothing", "level", "marker", "percent", "double", "clockwise"],
  ...["anticlockwise", "counterclockwise", "counter", "about", "around", "at", "onto", "from"],
]);

/** What a marker is called in a clause: its letter, "marker B", set apart from the words round it. */
type MarkerWord = string | null;

function parseRotate(args: string[], about: MarkerWord): Clause | null {
  const anti = args.some((w) => w === "anticlockwise" || w === "counterclockwise" || w === "counter");
  const clockwise = !anti && args.includes("clockwise");
  const rest = args.filter(
    (w) => w !== "anticlockwise" && w !== "counterclockwise" && w !== "counter" && w !== "clockwise",
  );
  const number = readNumber(rest, 0);
  if (!number || number.next !== rest.length || number.value === 0) return null;
  return { kind: "rotate", deg: clockwise ? -number.value : number.value, ...(about ? { about } : {}) };
}

function parseMirror(given: string[], about: MarkerWord): Clause | null {
  // "mirror this across x", "mirror it about the y axis": which way round is in the axis.
  const args = given.filter((word) => !["across", "about", "around"].includes(word));
  const direction = args.length === 1 ? AXES[args[0] as string] : undefined;
  if (!direction || direction.axis === 2) return null;
  return { kind: "mirror", axis: direction.axis === 0 ? "x" : "y", ...(about ? { about } : {}) };
}

/**
 * The words a removed command took, besides the grammar's own: its counts and factors. "Copy 4 times 6 m along y" and
 * "scale it by half" are the removed commands; "copy this onto every floor" is a request for the agent.
 */
const REMOVED_ARGS = new Set([
  "times",
  "time",
  "copies",
  "copy",
  "twice",
  "once",
  "by",
  "double",
  "triple",
  "half",
]);
/** The words that name elements: a removed command never took them ("copy the wall" is the agent's). */
const SELECTOR_WORDS = new Set(["all", "everything", "none", "nothing", "level", "marker"]);
const removedArg = (word: string) =>
  /^-?\d+(\.\d+)?$/.test(word) ||
  REMOVED_ARGS.has(word) ||
  (COMMAND_VOCABULARY.has(word) && !(word in VERBS) && !(word in TYPE_WORDS) && !SELECTOR_WORDS.has(word));

function parseClause(verb: string, args: string[], marker: MarkerWord): Clause | null {
  // A command that made geometry, said as it used to be said, is only heard; with anything else it is the agent's.
  // Scale took a marker as its pivot; copy and array never did.
  if (REMOVED_VERBS.has(verb))
    return (!marker || verb === "scale") && args.every(removedArg)
      ? { kind: "removed", what: verb as RemovedVerb }
      : null;
  // A marker is the pivot of a rotate or mirror and the place of a move; nothing else takes one.
  if (marker && !["move", "rotate", "mirror"].includes(verb)) return null;
  switch (verb) {
    case "move": {
      if (marker) return args.length === 0 ? { kind: "moveTo", marker } : null;
      const by = readOffset(args);
      return by ? { kind: "translate", by } : null;
    }
    case "rotate":
      return parseRotate(args, marker);
    case "mirror":
      return parseMirror(args, marker);
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
    case "group":
    case "ungroup": {
      // "group this", "ungroup the selection": it acts on what "this" is, and names nothing else.
      const read = readSelector(args);
      return read && read.selector === null ? { kind: verb } : null;
    }
  }
  return null;
}

/** Words that introduce a marker: "rotate 45 about marker B", "move to marker A". */
const MARKER_LEADS = new Set(["about", "around", "at", "to", "onto", "from"]);

/**
 * A clause's words without "marker B" (and the word that led to it), and the marker's letter. Null when "marker" is not
 * followed by a single letter, which makes the transcript the agent's. A letter said as a name ("bee") is not heard.
 */
function takeMarker(words: string[]): { rest: string[]; marker: string | null } | null {
  const at = words.indexOf("marker");
  if (at < 0) return { rest: words, marker: null };
  const letter = words[at + 1];
  if (!letter || !/^[a-z]$/.test(letter)) return null;
  const from = MARKER_LEADS.has(words[at - 1] ?? "") ? at - 1 : at;
  return { rest: [...words.slice(0, from), ...words.slice(at + 2)], marker: letter.toUpperCase() };
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
  return !rest.some((c) => c.kind === "select");
}

/**
 * The command a transcript is, or null. Everything said must be understood: one word the grammar does not know and the
 * transcript is the agent's. Clauses are joined by "and", "then" or a comma ("move 2 m east and rotate 90"); a clause
 * that is only a distance goes on the move before it ("move 2 m up and 3 m east"). A removed command in a transcript
 * understood in full ("copy", "array", "scale") makes the whole of it that command, which changes nothing.
 */
export function parseCommand(text: string): Command | null {
  const words = wordsOf(text);
  while (words.length > 0 && POLITE.has(words[words.length - 1] ?? "")) words.pop();
  if (words.length === 0) return null;

  const parts: string[][] = [[]];
  for (const word of words) {
    if (SEPARATORS.has(word)) parts.push([]);
    else (parts[parts.length - 1] as string[]).push(word);
  }

  const clauses: Clause[] = [];
  for (const part of parts) {
    // "I want to move this" and "and then please rotate it": the talk before the verb is dropped, clause by clause.
    while (LEADING.has(part[0] ?? "")) part.shift();
    // "and then" leaves nothing between the two.
    if (part.length === 0) continue;
    const [head, ...tail] = part;
    const verb = head === undefined ? undefined : VERBS[head];
    const named = takeMarker(tail);
    if (!named) return null;
    const args = named.rest.filter((w) => !FILLER.has(w));
    if (verb) {
      const clause = parseClause(verb, args, named.marker);
      if (!clause) return null;
      clauses.push(clause);
      continue;
    }
    // No verb: more distance for the move before.
    const previous = clauses[clauses.length - 1];
    const more = readOffset(part.filter((w) => !FILLER.has(w)));
    if (!more || previous?.kind !== "translate") return null;
    const { by } = previous;
    previous.by = [by[0] + more[0], by[1] + more[1], by[2] + more[2]];
  }
  // Understood, with a removed command in it: that command is the whole of it, and nothing is changed.
  const removed = clauses.find((c) => c.kind === "removed");
  if (removed) return { clauses: [removed] };
  return validSequence(clauses) ? { clauses } : null;
}

/** What a correction says the number was meant to be: "make it 4 m", "no, 45 degrees". */
export type Correction =
  | { kind: "length"; mm: number }
  | { kind: "angle"; deg: number }
  /** A bare number: for whichever number the last command had (its distance or angle). */
  | { kind: "number"; value: number };

/** Words that say a number is being put right rather than a new thing asked for. */
const CORRECTS = new Set([
  ...[
    "make",
    "change",
    "set",
    "adjust",
    "update",
    "edit",
    "fix",
    "no",
    "nope",
    "actually",
    "rather",
    "sorry",
  ],
  ...["wait", "oops", "meant", "mean", "correction", "instead"],
]);
/** What can stand around the number of a correction without saying anything of its own: "make it be 4 m". */
const AROUND_CORRECTION = new Set([
  ...CORRECTS,
  ...[
    "it",
    "its",
    "that",
    "this",
    "to",
    "be",
    "the",
    "distance",
    "length",
    "angle",
    "count",
    "number",
    "amount",
  ],
  ...[
    "size",
    "factor",
    "spacing",
    "only",
    "just",
    "please",
    "now",
    "i",
    "id",
    "im",
    "let",
    "lets",
    "can",
    "could",
  ],
  ...["you", "would", "thanks", "thank", "a", "an", "of", "by", "at", "should", "is", "was", "not", "and"],
]);

/**
 * A correction of the last command, or null: it must say it is one ("make it 4 m", "change it to 4m", "no, 4 metres",
 * "actually 30 degrees", "4 metres instead") and be nothing but the new number with its unit. "Make this 300 thick" is not
 * one (it says what thickness), nor is a bare "4 m": without a word like make, change or no it is a new request.
 */
export function parseCorrection(text: string): Correction | null {
  const words = wordsOf(text);
  while (POLITE.has(words[words.length - 1] ?? "")) words.pop();
  if (!words.some((word) => CORRECTS.has(word))) return null;
  const rest = words.filter((word) => !AROUND_CORRECTION.has(word));
  const number = readNumber(rest, 0);
  if (!number) {
    // "make it a metre": the unit alone is one of it.
    const alone = rest.length === 1 ? readLength(rest, 0) : null;
    return alone ? { kind: "length", mm: alone.value } : null;
  }
  const tail = rest.slice(number.next);
  const unit = tail[0] ?? "";
  if (tail.length === 0) return { kind: "number", value: number.value };
  if (tail.length !== 1) return null;
  if (UNIT_WORDS.has(unit)) {
    const length = readLength(rest, 0);
    return length && length.next === rest.length
      ? { kind: "length", mm: Math.round(length.value * 100) / 100 }
      : null;
  }
  if (["degrees", "degree", "deg"].includes(unit)) return { kind: "angle", deg: number.value };
  return null;
}

/**
 * The command with its number put right, or a sentence saying why it cannot be: the last distance or angle it has. A
 * bare number goes to whichever the command is about: a rotate's angle, a move's distance (in metres when the old one
 * was whole metres, else millimetres).
 */
export function correctCommand(command: Command, correction: Correction): Command | string {
  const clauses = command.clauses.map((clause) => ({ ...clause })) as Clause[];
  const at = (match: (clause: Clause) => boolean) => {
    for (let i = clauses.length - 1; i >= 0; i--) if (match(clauses[i] as Clause)) return i;
    return -1;
  };
  const setLength = (mm: number): Command | string => {
    const i = at((c) => c.kind === "translate");
    if (i < 0) return "There is no distance in that to change.";
    const clause = clauses[i] as Extract<Clause, { kind: "translate" }>;
    const length = Math.hypot(clause.by[0], clause.by[1], clause.by[2]);
    if (length === 0) return "There is no distance in that to change.";
    const by = clause.by.map((v) => (v * mm) / length) as Point3Mm;
    clauses[i] = { ...clause, by };
    return { clauses };
  };
  const setAngle = (deg: number): Command | string => {
    const i = at((c) => c.kind === "rotate");
    if (i < 0) return "There is no angle in that to change.";
    const clause = clauses[i] as Extract<Clause, { kind: "rotate" }>;
    if (deg === 0) return "A rotation of 0 turns nothing.";
    clauses[i] = { ...clause, deg: deg < 0 ? deg : Math.sign(clause.deg) * Math.abs(deg) };
    return { clauses };
  };
  switch (correction.kind) {
    case "length":
      return setLength(correction.mm);
    case "angle":
      return setAngle(correction.deg);
    case "number": {
      const last = clauses[at((c) => c.kind !== "select")];
      if (!last) return "There is nothing to change.";
      switch (last.kind) {
        case "rotate":
          return setAngle(correction.value);
        case "translate":
          return setLength(correction.value * wholeMetres(last.by));
        default:
          return "There is no number in that to change.";
      }
    }
  }
}

/** The unit a bare number is in: metres when the old distance was a whole number of them, else millimetres. */
function wholeMetres(by: Point3Mm): number {
  const length = Math.hypot(by[0], by[1], by[2]);
  return length >= 1000 && Math.abs(length / 1000 - Math.round(length / 1000)) < 1e-6 ? 1000 : 1;
}
