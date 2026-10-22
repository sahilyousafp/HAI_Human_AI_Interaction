import type { Message, SceneDocument, SceneOp } from "@aex/protocol";
import { applyTransaction } from "@aex/scene";

export interface SceneState {
  doc: SceneDocument | null;
  seq: number;
  selection: string[];
  project: { name: string; path: string } | null;
  canUndo: boolean;
  canRedo: boolean;
  savedAt: string | null;
  /** Project load or save problem reported by the bridge. */
  projectError: string | null;
  /** Last rejected request, shown briefly to the user. */
  lastError: string | null;
  /** Why the last Open or New project request was refused, if it was. */
  projectMessage: string | null;
  /** The most recent change to the scene: what kind, its label, and when it arrived (ms). */
  lastChange: { kind: "apply" | "undo" | "redo"; label: string; at: number } | null;
}

const INITIAL: SceneState = {
  doc: null,
  seq: 0,
  selection: [],
  project: null,
  canUndo: false,
  canRedo: false,
  savedAt: null,
  projectError: null,
  lastError: null,
  projectMessage: null,
  lastChange: null,
};

const newId = () => crypto.randomUUID();

/**
 * The browser's copy of the bridge's scene. Applies patches strictly in sequence order; on a gap it asks the
 * bridge for a fresh snapshot. Selection changes show immediately and are reconciled when the bridge echoes them.
 */
export class SceneClient {
  private state = INITIAL;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly send: (message: Message) => boolean) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SceneState => this.state;

  /** Handles a bridge message; returns false if it was not about the scene. */
  handle(message: Message): boolean {
    switch (message.type) {
      case "scene.snapshot": {
        const { doc, seq, selection, project, canUndo, canRedo } = message.payload;
        this.update({ doc, seq, selection, project, canUndo, canRedo });
        return true;
      }
      case "scene.patch": {
        const { seq, ops, canUndo, canRedo, kind, label } = message.payload;
        if (!this.state.doc || seq !== this.state.seq + 1) {
          this.resync();
          return true;
        }
        const result = applyTransaction(this.state.doc, ops);
        if (!result.ok) {
          this.resync();
          return true;
        }
        this.update({ doc: result.doc, seq, canUndo, canRedo, lastChange: { kind, label, at: Date.now() } });
        return true;
      }
      case "selection.changed":
        this.update({ selection: message.payload.ids });
        return true;
      case "project.status":
        this.update({
          project: message.payload.project,
          savedAt: message.payload.savedAt,
          projectError: message.payload.error,
        });
        return true;
      case "request.error":
        this.update({
          lastError: message.payload.message,
          ...(message.payload.requestId === this.projectRequest
            ? { projectMessage: message.payload.message }
            : {}),
        });
        return true;
      default:
        return false;
    }
  }

  apply(label: string, ops: SceneOp[]): boolean {
    return this.send({ type: "scene.apply", id: newId(), payload: { label, ops } });
  }

  undo(): boolean {
    return this.send({ type: "scene.undo", id: newId(), payload: {} });
  }

  redo(): boolean {
    return this.send({ type: "scene.redo", id: newId(), payload: {} });
  }

  select(ids: string[]): void {
    this.update({ selection: ids });
    this.send({ type: "selection.set", id: newId(), payload: { ids } });
  }

  /** The id of the last Open or New project request, so its refusal can be told from other errors. */
  private projectRequest: string | null = null;

  openProject(path: string): boolean {
    return this.projectCall("project.open", path);
  }

  /** Starts a new, empty project in a folder that holds none yet; the bridge refuses one that does. */
  createProject(path: string): boolean {
    return this.projectCall("project.create", path);
  }

  /** Dismisses the message about a refused project request. */
  clearProjectMessage(): void {
    this.update({ projectMessage: null });
  }

  private projectCall(type: "project.open" | "project.create", path: string): boolean {
    this.projectRequest = newId();
    this.update({ projectMessage: null });
    return this.send({ type, id: this.projectRequest, payload: { path } });
  }

  private resync(): void {
    this.send({ type: "scene.resync", id: newId(), payload: {} });
  }

  private update(partial: Partial<SceneState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }
}
