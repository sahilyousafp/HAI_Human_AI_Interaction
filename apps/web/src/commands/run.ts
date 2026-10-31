import type { LetterMarker, SceneDocument, SceneOp } from "@hai/protocol";
import type { Visibility } from "../viewer/visibility.ts";
import { type Command, correctCommand, parseCommand, parseCorrection } from "./grammar.ts";
import { planCommand } from "./plan.ts";

/** What a spoken command can reach: the model, the selection, the viewer's visibility and the notice line. */
export interface CommandHost {
  doc(): SceneDocument | null;
  /** Applies ops as one undo step; false when the bridge could not take them. */
  apply(label: string, ops: SceneOp[]): boolean;
  select(ids: string[]): void;
  /** Asks a question a nod or Enter answers yes. */
  ask(question: string, answer: (yes: boolean) => void): void;
  flash(message: string): void;
  /** The project's lettered markers ("rotate 45 about marker B"). */
  markers(): LetterMarker[];
  /** The scene's sequence number: it moves on with every change, undo included. */
  seq(): number;
  /** Undoes the last change; false when the bridge could not take it. */
  undo(): boolean;
  visibility: Visibility;
}

/** A transcript that was a command: what to show for it. Whether it worked or not, it never goes to the agent. */
export interface CommandRun {
  label: string;
}

/** A change a command made, kept so that a correction ("make it 4 m") can take it back and make it again. */
interface Remembered {
  command: Command;
  thisIds: string[];
  /** The model as it was before the command, which the corrected command is worked out from. */
  before: SceneDocument;
  /** The sequence number the model has once that change is in and nothing else has happened. */
  expectedSeq: number;
  at: number;
}

/** How long after a command it can still be corrected, ms. */
export const CORRECTION_WINDOW_MS = 120_000;

/**
 * The last change a spoken command made, for corrections. A correction only counts while nothing else has changed the
 * model (the sequence number says so) and it is recent; otherwise it is an ordinary request.
 */
export class CommandMemory {
  last: Remembered | null = null;
  remember(entry: Remembered): void {
    this.last = entry;
  }
  forget(): void {
    this.last = null;
  }
}

/** Whether a command changes the model in a way a correction can redo: it moves, copies, rotates or scales. */
const redoable = (command: Command): boolean =>
  command.clauses.some(
    (c) => c.kind === "translate" || c.kind === "copy" || c.kind === "rotate" || c.kind === "scale",
  );

/**
 * "Make it 4 m", "change it to 4 times", "no, 45 degrees": puts right the number of the command just run. The change
 * is taken back and made again with the new number, as one more undo step, selecting what it makes. Null when the
 * transcript is not a correction, or there is nothing recent and untouched to correct (it is then an ordinary request).
 */
export function reviseCommand(
  text: string,
  host: CommandHost,
  memory: CommandMemory,
  now: number = Date.now(),
): CommandRun | null {
  const correction = parseCorrection(text);
  const last = memory.last;
  if (!correction || !last || now - last.at > CORRECTION_WINDOW_MS || host.seq() !== last.expectedSeq)
    return null;
  const revised = correctCommand(last.command, correction);
  if (typeof revised === "string") {
    host.flash(revised);
    return { label: revised };
  }
  const plan = planCommand(revised, last.before, last.thisIds, host.markers());
  if (plan.kind !== "edit") {
    const message = plan.kind === "error" ? plan.message : "That cannot be corrected.";
    host.flash(message);
    return { label: message };
  }
  const seq = host.seq();
  if (!host.undo() || !host.apply(plan.label, plan.ops)) {
    host.flash("The change could not be made.");
    return { label: "The change could not be made." };
  }
  if (plan.select) host.select(plan.select);
  host.flash(`${plan.label}.`);
  // The undo and the new change are two more steps in the scene's sequence.
  memory.remember({ ...last, command: revised, expectedSeq: seq + 2, at: now });
  return { label: plan.label };
}

/**
 * Runs a transcript as a command when the grammar understands all of it, on `thisIds` (what was pointed at or is
 * selected) or what the command itself selects. Null when it is not a command, which makes it a request for the agent.
 */
export function runCommand(
  text: string,
  host: CommandHost,
  thisIds: string[],
  memory?: CommandMemory,
): CommandRun | null {
  const command = parseCommand(text);
  if (!command) return null;
  const doc = host.doc();
  if (!doc) return { label: "The model is not loaded yet." };
  const plan = planCommand(command, doc, thisIds, host.markers());
  // The sequence number before the change goes in: it moves on when the bridge answers, which is after this.
  const seqBefore = host.seq();
  switch (plan.kind) {
    case "error":
      host.flash(plan.message);
      return { label: plan.message };
    case "select":
      host.select(plan.ids);
      host.flash(plan.ids.length === 0 ? "Selection cleared." : `Selected ${plan.ids.length}.`);
      return { label: plan.label };
    case "edit":
      if (!host.apply(plan.label, plan.ops)) {
        host.flash("The change could not be made.");
        return { label: "The change could not be made." };
      }
      if (plan.select) host.select(plan.select);
      host.flash(`${plan.label}.`);
      if (memory && redoable(command))
        memory.remember({ command, thisIds, before: doc, expectedSeq: seqBefore + 1, at: Date.now() });
      return { label: plan.label };
    case "delete":
      host.ask(`${plan.label}? Nod or press Enter to delete. Shake or press Escape to keep.`, (yes) => {
        if (!yes) return host.flash("Kept.");
        host.apply(
          plan.label,
          plan.ids.map((id): SceneOp => ({ op: "delete", id })),
        );
      });
      return { label: plan.label };
    case "hide":
      host.visibility.hide(plan.ids);
      host.flash(`Hid ${plan.ids.length}. Say "show all" to bring them back.`);
      return { label: plan.label };
    case "isolate":
      host.visibility.isolate(plan.ids, Object.keys(doc.elements));
      host.flash(`Isolated ${plan.ids.length}. Say "show all" to bring the rest back.`);
      return { label: plan.label };
    case "showAll":
      host.visibility.showAll();
      host.flash("Everything is shown.");
      return { label: plan.label };
  }
}
