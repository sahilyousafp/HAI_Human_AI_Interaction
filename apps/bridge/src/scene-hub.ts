import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Message, type MessageOf, parseScene, type SceneDocument } from "@aex/protocol";
import { Autosaver, openProject, type ProjectInfo, SAMPLE_SCENE } from "./project.ts";
import { SceneStore, type StoreResult } from "./scene-store.ts";

type Send = (message: Message) => void;

export interface SceneHubOptions {
  /** Project folder to open at start; without one, the sample scene is served from memory and not saved. */
  projectDir?: string;
  /** Autosave delay in ms. */
  saveDelayMs?: number;
  /** Called after a project folder is opened successfully (used to remember it). */
  onProjectOpened?: (project: ProjectInfo) => void;
}

const id = () => randomUUID();

function loadSample(): SceneDocument {
  const parsed = parseScene(JSON.parse(readFileSync(SAMPLE_SCENE, "utf8")));
  if (!parsed.ok) throw new Error(`Sample scene is invalid: ${parsed.error}`);
  return parsed.doc;
}

/** Owns the authoritative scene, its project folder and autosave, and answers scene messages from clients. */
export class SceneHub {
  private store: SceneStore;
  private project: ProjectInfo | null = null;
  private autosaver: Autosaver | null = null;
  private detach: (() => void) | null = null;
  private projectError: string | null = null;

  constructor(
    private readonly options: SceneHubOptions,
    private readonly broadcast: Send,
  ) {
    this.store = new SceneStore(loadSample());
    if (options.projectDir) this.open(options.projectDir);
  }

  get scene(): SceneStore {
    return this.store;
  }

  /** Everything a newly connected client needs. */
  greet(send: Send): void {
    send(this.snapshot());
    send(this.projectStatus());
  }

  /** Handles a scene message from a client. Returns false for messages that are not about the scene. */
  handle(message: Message, send: Send): boolean {
    switch (message.type) {
      case "scene.apply":
        this.publish(this.store.apply(message.payload.label, message.payload.ops), message, send);
        return true;
      case "scene.undo":
        this.publish(this.store.undo(), message, send);
        return true;
      case "scene.redo":
        this.publish(this.store.redo(), message, send);
        return true;
      case "scene.resync":
        send(this.snapshot());
        return true;
      case "selection.set":
        if (this.store.setSelection(message.payload.ids)) this.broadcastSelection();
        return true;
      case "project.open": {
        const error = this.open(message.payload.path);
        if (error)
          send({ type: "request.error", id: id(), payload: { requestId: message.id, message: error } });
        this.broadcast(this.snapshot());
        this.broadcast(this.projectStatus());
        return true;
      }
      default:
        return false;
    }
  }

  /** Writes any pending change (on shutdown). */
  async flush(): Promise<void> {
    await this.autosaver?.flush();
  }

  private open(dir: string): string | null {
    const result = openProject(dir);
    if (!result.ok) {
      this.projectError = result.error;
      return result.error;
    }
    void this.autosaver?.flush();
    this.detach?.();
    this.project = result.project;
    this.projectError = null;
    this.store = new SceneStore(result.doc);
    const autosaver = new Autosaver(
      result.project.path,
      () => this.broadcast(this.projectStatus()),
      this.options.saveDelayMs ?? 2000,
    );
    this.autosaver = autosaver;
    this.detach = this.store.onChange((doc) => autosaver.schedule(doc));
    this.options.onProjectOpened?.(result.project);
    return null;
  }

  private publish(result: StoreResult, request: Message, send: Send): void {
    if (!result.ok) {
      send({ type: "request.error", id: id(), payload: { requestId: request.id, message: result.error } });
      return;
    }
    this.broadcast({ type: "scene.patch", id: id(), payload: result.patch });
    if (result.selectionChanged) this.broadcastSelection();
  }

  private broadcastSelection(): void {
    this.broadcast({ type: "selection.changed", id: id(), payload: { ids: this.store.selection } });
  }

  private snapshot(): MessageOf<"scene.snapshot"> {
    return {
      type: "scene.snapshot",
      id: id(),
      payload: {
        seq: this.store.sequence,
        doc: this.store.doc,
        selection: this.store.selection,
        project: this.project,
        canUndo: this.store.canUndo,
        canRedo: this.store.canRedo,
      },
    };
  }

  private projectStatus(): MessageOf<"project.status"> {
    return {
      type: "project.status",
      id: id(),
      payload: {
        project: this.project,
        savedAt: this.autosaver?.savedAt ?? null,
        error: this.projectError ?? this.autosaver?.lastError ?? null,
      },
    };
  }
}
