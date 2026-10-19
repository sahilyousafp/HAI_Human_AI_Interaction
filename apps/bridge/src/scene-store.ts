import type { SceneDocument, SceneOp } from "@aex/protocol";
import { applyTransaction, History } from "@aex/scene";

export interface ScenePatch {
  seq: number;
  kind: "apply" | "undo" | "redo";
  label: string;
  ops: SceneOp[];
  canUndo: boolean;
  canRedo: boolean;
}

export type StoreResult =
  | { ok: true; patch: ScenePatch; selectionChanged: boolean }
  | { ok: false; error: string };

/**
 * The authoritative scene: every change is a labelled transaction with a sequence number,
 * so clients can apply patches in order and ask for a snapshot if they miss one.
 */
export class SceneStore {
  private seq = 0;
  private selectionIds: string[] = [];
  private readonly history = new History();
  private readonly listeners = new Set<(doc: SceneDocument) => void>();

  constructor(private current: SceneDocument) {}

  get doc(): SceneDocument {
    return this.current;
  }

  get sequence(): number {
    return this.seq;
  }

  get selection(): string[] {
    return this.selectionIds;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** Called with the new document after every change (used for autosave). */
  onChange(listener: (doc: SceneDocument) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  apply(label: string, ops: SceneOp[]): StoreResult {
    const result = applyTransaction(this.current, ops);
    if (!result.ok) return result;
    this.history.record({ label, ops, inverse: result.inverse });
    return this.commit(result.doc, "apply", label, ops);
  }

  undo(): StoreResult {
    const step = this.history.undo(this.current);
    if (!step.ok) return step;
    return this.commit(step.doc, "undo", step.label, step.ops);
  }

  redo(): StoreResult {
    const step = this.history.redo(this.current);
    if (!step.ok) return step;
    return this.commit(step.doc, "redo", step.label, step.ops);
  }

  /** Sets the selection to the given ids that exist in the scene; returns true if it changed. */
  setSelection(ids: string[]): boolean {
    const next = [...new Set(ids)].filter((id) => this.current.elements[id]);
    const changed =
      next.length !== this.selectionIds.length || next.some((id, i) => id !== this.selectionIds[i]);
    this.selectionIds = next;
    return changed;
  }

  private commit(doc: SceneDocument, kind: ScenePatch["kind"], label: string, ops: SceneOp[]): StoreResult {
    this.current = doc;
    this.seq += 1;
    // Deleted elements drop out of the selection.
    const before = this.selectionIds.length;
    this.selectionIds = this.selectionIds.filter((id) => doc.elements[id]);
    for (const listener of this.listeners) listener(doc);
    return {
      ok: true,
      patch: { seq: this.seq, kind, label, ops, canUndo: this.canUndo, canRedo: this.canRedo },
      selectionChanged: this.selectionIds.length !== before,
    };
  }
}
