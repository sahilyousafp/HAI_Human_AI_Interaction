import type { SceneDocument, SceneOp } from "@hai/protocol";
import { applyTransaction, History } from "@hai/scene";

export interface ScenePatch {
  seq: number;
  kind: "apply" | "undo" | "redo";
  label: string;
  /** Who made the change: "user", or the agent's name. */
  by: string;
  ops: SceneOp[];
  canUndo: boolean;
  canRedo: boolean;
}

export type StoreResult =
  | { ok: true; patch: ScenePatch; selectionChanged: boolean }
  | { ok: false; error: string };

const USER = "user";

interface Group {
  label: string;
  ops: SceneOp[];
  inverse: SceneOp[];
}

/**
 * The authoritative scene: every change is a labelled transaction with a sequence number,
 * so clients can apply patches in order and ask for a snapshot if they miss one.
 */
export class SceneStore {
  private seq = 0;
  private selectionIds: string[] = [];
  private readonly history = new History();
  /**
   * The turns in progress, one per agent: changes are applied as they come but each agent's are undone as one step.
   * Map order is order of last activity (a group is re-inserted when it changes), which is the order undo records them.
   */
  private readonly groups = new Map<string, Group>();
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

  apply(label: string, ops: SceneOp[], by = USER): StoreResult {
    const result = applyTransaction(this.current, ops);
    if (!result.ok) return result;
    this.history.record({ label, ops, inverse: result.inverse });
    return this.commit(result.doc, "apply", label, by, ops);
  }

  /** Starts grouping an agent's changes: everything applied with `applyInGroup` until `endGroup` is one undo step. */
  beginGroup(agent: string, label: string): void {
    this.groups.set(agent, { label, ops: [], inverse: [] });
  }

  /**
   * Applies an agent change now (clients see it at once) without its own undo step; it joins that agent's open group.
   * Without a group it is an ordinary transaction. A batch that fails validation changes nothing.
   */
  applyInGroup(ops: SceneOp[], agent: string | null, label = "Agent"): StoreResult {
    const group = agent ? this.groups.get(agent) : undefined;
    if (!agent || !group) return this.apply(label, ops, agent ?? "agent");
    const result = applyTransaction(this.current, ops);
    if (!result.ok) return result;
    group.ops.push(...ops);
    group.inverse = [...result.inverse, ...group.inverse];
    // Re-inserted so the map stays in order of last activity.
    this.groups.delete(agent);
    this.groups.set(agent, group);
    return this.commit(result.doc, "apply", group.label, agent, ops);
  }

  /**
   * Closes an agent's group and records it as one undo step. Returns a patch with no ops (so clients learn they can
   * now undo it), or null when the group changed nothing.
   */
  endGroup(agent: string): StoreResult | null {
    const group = this.groups.get(agent);
    this.groups.delete(agent);
    return group ? this.recordGroup(agent, group) : null;
  }

  undo(): StoreResult {
    // Undo during agent work records what each agent has done so far as a step, and each carries on in a new one;
    // the newest step (the agent that was active last) is the one undone.
    for (const [agent, group] of [...this.groups]) {
      if (group.ops.length === 0) continue;
      this.recordGroup(agent, group);
      this.groups.set(agent, { label: group.label, ops: [], inverse: [] });
    }
    const step = this.history.undo(this.current);
    if (!step.ok) return step;
    return this.commit(step.doc, "undo", step.label, USER, step.ops);
  }

  redo(): StoreResult {
    const step = this.history.redo(this.current);
    if (!step.ok) return step;
    return this.commit(step.doc, "redo", step.label, USER, step.ops);
  }

  private recordGroup(agent: string, group: Group): StoreResult | null {
    if (group.ops.length === 0) return null;
    this.history.record({ label: group.label, ops: group.ops, inverse: group.inverse });
    return this.commit(this.current, "apply", group.label, agent, []);
  }

  /** Sets the selection to the given ids that exist in the scene; returns true if it changed. */
  setSelection(ids: string[]): boolean {
    const next = [...new Set(ids)].filter((id) => this.current.elements[id]);
    const changed =
      next.length !== this.selectionIds.length || next.some((id, i) => id !== this.selectionIds[i]);
    this.selectionIds = next;
    return changed;
  }

  private commit(
    doc: SceneDocument,
    kind: ScenePatch["kind"],
    label: string,
    by: string,
    ops: SceneOp[],
  ): StoreResult {
    this.current = doc;
    this.seq += 1;
    // Deleted elements drop out of the selection.
    const before = this.selectionIds.length;
    this.selectionIds = this.selectionIds.filter((id) => doc.elements[id]);
    for (const listener of this.listeners) listener(doc);
    return {
      ok: true,
      patch: { seq: this.seq, kind, label, by, ops, canUndo: this.canUndo, canRedo: this.canRedo },
      selectionChanged: this.selectionIds.length !== before,
    };
  }
}
