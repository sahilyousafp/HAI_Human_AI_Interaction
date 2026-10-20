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
  /** An agent turn in progress: its changes are applied as they come but undone as one step. */
  private group: { label: string; ops: SceneOp[]; inverse: SceneOp[] } | null = null;
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

  /** Starts grouping agent changes: everything applied with `applyInGroup` until `endGroup` is one undo step. */
  beginGroup(label: string): void {
    this.group = { label, ops: [], inverse: [] };
  }

  /**
   * Applies an agent change now (clients see it at once) without its own undo step; it joins the open group.
   * Without a group it is an ordinary transaction. A batch that fails validation changes nothing.
   */
  applyInGroup(ops: SceneOp[], label = "Agent"): StoreResult {
    if (!this.group) return this.apply(label, ops);
    const result = applyTransaction(this.current, ops);
    if (!result.ok) return result;
    this.group.ops.push(...ops);
    this.group.inverse = [...result.inverse, ...this.group.inverse];
    return this.commit(result.doc, "apply", this.group.label, ops);
  }

  /**
   * Closes the group and records it as one undo step. Returns a patch with no ops (so clients learn they can now
   * undo it), or null when the group changed nothing.
   */
  endGroup(): StoreResult | null {
    const group = this.group;
    this.group = null;
    return group ? this.recordGroup(group) : null;
  }

  undo(): StoreResult {
    // Undo during an agent turn undoes the turn so far; the turn's later changes start a new step.
    if (this.group?.ops.length) {
      this.recordGroup(this.group);
      this.group = { label: this.group.label, ops: [], inverse: [] };
    }
    const step = this.history.undo(this.current);
    if (!step.ok) return step;
    return this.commit(step.doc, "undo", step.label, step.ops);
  }

  redo(): StoreResult {
    const step = this.history.redo(this.current);
    if (!step.ok) return step;
    return this.commit(step.doc, "redo", step.label, step.ops);
  }

  private recordGroup(group: { label: string; ops: SceneOp[]; inverse: SceneOp[] }): StoreResult | null {
    if (group.ops.length === 0) return null;
    this.history.record({ label: group.label, ops: group.ops, inverse: group.inverse });
    return this.commit(this.current, "apply", group.label, []);
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
