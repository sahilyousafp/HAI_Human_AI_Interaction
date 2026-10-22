import type { SceneDocument, SceneOp } from "@hai/protocol";
import { applyTransaction } from "./ops.ts";

export interface Transaction {
  label: string;
  ops: SceneOp[];
  inverse: SceneOp[];
}

export type HistoryStep =
  | { ok: true; doc: SceneDocument; label: string; ops: SceneOp[] }
  | { ok: false; error: string };

/** Labelled undo and redo over transactions. Undo reverts a whole transaction; redo reapplies it. */
export class History {
  private readonly undoStack: Transaction[] = [];
  private readonly redoStack: Transaction[] = [];

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Records an applied transaction; a new edit clears the redo stack. */
  record(tx: Transaction): void {
    this.undoStack.push(tx);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(doc: SceneDocument): HistoryStep {
    const tx = this.undoStack.pop();
    if (!tx) return { ok: false, error: "Nothing to undo" };
    const result = applyTransaction(doc, tx.inverse);
    if (!result.ok) {
      this.undoStack.push(tx);
      return result;
    }
    this.redoStack.push(tx);
    return { ok: true, doc: result.doc, label: tx.label, ops: tx.inverse };
  }

  redo(doc: SceneDocument): HistoryStep {
    const tx = this.redoStack.pop();
    if (!tx) return { ok: false, error: "Nothing to redo" };
    const result = applyTransaction(doc, tx.ops);
    if (!result.ok) {
      this.redoStack.push(tx);
      return result;
    }
    this.undoStack.push(tx);
    return { ok: true, doc: result.doc, label: tx.label, ops: tx.ops };
  }
}
