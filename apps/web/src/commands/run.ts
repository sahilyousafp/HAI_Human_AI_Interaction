import type { LetterMarker, SceneDocument, SceneOp } from "@hai/protocol";
import type { Visibility } from "../viewer/visibility.ts";
import { parseCommand } from "./grammar.ts";
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
  visibility: Visibility;
}

/** A transcript that was a command: what to show for it. Whether it worked or not, it never goes to the agent. */
export interface CommandRun {
  label: string;
}

/**
 * Runs a transcript as a command when the grammar understands all of it, on `thisIds` (what was pointed at or is
 * selected) or what the command itself selects. Null when it is not a command, which makes it a request for the agent.
 */
export function runCommand(text: string, host: CommandHost, thisIds: string[]): CommandRun | null {
  const command = parseCommand(text);
  if (!command) return null;
  const doc = host.doc();
  if (!doc) return { label: "The model is not loaded yet." };
  const plan = planCommand(command, doc, thisIds, host.markers());
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
