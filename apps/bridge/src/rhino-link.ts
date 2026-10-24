import { randomUUID } from "node:crypto";
import {
  EMPTY_NOT_DRAWN,
  type Message,
  type ModellingInUse,
  type ModellingMode,
  type RhinoBatch,
  type RhinoHello,
  type RhinoNotDrawn,
  type RhinoObject,
  type RhinoPythonResult,
  type RhinoPythonStatus,
  type RhinoSelected,
  type RhinoSync,
} from "@hai/protocol";
import type { Logger } from "./log.ts";

type Send = (message: Message) => void;

/** The part of the mirror's asset store the link uses. */
export interface MirrorAssets {
  has(id: string): boolean;
  remove(id: string): void;
  clear(): void;
}

export interface RhinoLinkOptions {
  /** The user's choice in Settings > Modelling. */
  mode(): ModellingMode;
  assets: MirrorAssets;
  log?: Logger;
  /** The tools the agent should have changed (Rhino connected or gone, Python ready or not, the mode): its sessions restart. */
  availabilityChanged?(): void;
}

/** How long past a script's own time limit the plugin may take to answer before the run is given up. */
const ANSWER_GRACE_MS = 5000;

/** What the bridge keeps of a connected Rhino: where it stands, and the mirror of its objects. */
interface Connection {
  send: Send;
  close(): void;
  hello: RhinoHello;
}

/**
 * The bridge's side of Rhino. The plugin connects as a local client; this holds what it reports (its Python status, its
 * document, the objects it meshed and the selection) and tells the viewers. The viewers draw the objects as a read-only
 * mirror, not as part of the scene. Which way the agent models is the user's setting, with Automatic following whether
 * Rhino is connected.
 */
export class RhinoLink {
  private connection: Connection | null = null;
  private python: RhinoPythonStatus | null = null;
  private document: string | null = null;
  private readonly objects = new Map<string, RhinoObject>();
  private readonly assetUses = new Map<string, number>();
  private notDrawn: RhinoNotDrawn = EMPTY_NOT_DRAWN;
  private sync: RhinoSync | null = null;
  private selected: RhinoSelected[] = [];
  /** What the agent's tools depend on, as of the last state sent. */
  private availability: string | null = null;
  private readonly pending = new Map<
    string,
    {
      resolve(result: RhinoPythonResult): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly options: RhinoLinkOptions,
    private readonly broadcast: Send,
  ) {}

  get connected(): boolean {
    return this.connection !== null;
  }

  /** The way the agent models now: Rhino when the user said so, or when it is connected and the setting is Automatic. */
  get inUse(): ModellingInUse {
    const mode = this.options.mode();
    if (mode === "python") return "python";
    if (mode === "rhino") return "rhino";
    return this.connected ? "rhino" : "python";
  }

  /** Whether the viewers draw Rhino's objects. */
  get mirrored(): boolean {
    return this.connected && this.options.mode() !== "python";
  }

  get pythonStatus(): RhinoPythonStatus | null {
    return this.python;
  }

  /** The mirrored Rhino object with this id, if any (the agent's "this" when the user points at it). */
  object(id: string): RhinoObject | undefined {
    return this.objects.get(id);
  }

  get selection(): RhinoSelected[] {
    return this.selected;
  }

  /** The Rhino plugin said hello. A plugin that was already connected is replaced. */
  attach(connection: Connection): void {
    this.connection?.close();
    this.dropMirror();
    this.connection = connection;
    this.python = connection.hello.python;
    this.document = connection.hello.document;
    this.options.log?.info("rhino connected", { rhino: connection.hello.rhinoVersion });
    this.publishState();
  }

  /** The plugin's connection ended (only the current one counts). */
  detach(connection: Connection): void {
    if (this.connection !== connection) return;
    this.connection = null;
    this.python = null;
    this.document = null;
    this.dropMirror();
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Rhino disconnected before the script finished."));
      this.pending.delete(id);
    }
    this.options.log?.info("rhino disconnected");
    this.publishState();
  }

  /** The user changed Settings > Modelling. */
  modeChanged(): void {
    this.publishState();
  }

  /** Sends a page what it needs to draw: the state of Rhino and the mirror. */
  greet(send: Send): void {
    send(this.state());
  }

  /** Handles a message from the plugin. Returns false for other messages. */
  handleFromRhino(message: Message): boolean {
    switch (message.type) {
      case "rhino.status":
        this.python = message.payload.python;
        this.document = message.payload.document;
        this.publishState();
        return true;
      case "rhino.objects":
        this.applyBatch(message.payload);
        return true;
      case "rhino.selection":
        this.selected = message.payload.objects;
        if (this.mirrored) this.broadcast(message);
        return true;
      case "rhino.python.result": {
        const pending = this.pending.get(message.payload.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.payload.id);
          pending.resolve(message.payload);
        }
        return true;
      }
      default:
        return false;
    }
  }

  /** Handles a message from a page: a pick in the viewer selects in Rhino. Returns false for other messages. */
  handleFromWeb(message: Message): boolean {
    if (message.type !== "rhino.select") return false;
    this.connection?.send({ type: "rhino.select", id: randomUUID(), payload: message.payload });
    return true;
  }

  /** Asks Rhino to open a file (an absolute path inside the project that the bridge has already checked). */
  open(path: string): boolean {
    if (!this.connection) return false;
    this.connection.send({ type: "rhino.open", id: randomUUID(), payload: { path } });
    return true;
  }

  /** Runs a script in the open Rhino document; rejects if Rhino is not connected, goes away, or does not answer. */
  runPython(code: string, timeoutMs: number): Promise<RhinoPythonResult> {
    const connection = this.connection;
    if (!connection) return Promise.reject(new Error("Rhino is not connected. Run HaiConnect in Rhino."));
    if (this.python?.state !== "ready") {
      const why =
        this.python?.state === "unavailable" ? this.python.reason : "its Python status is not known";
      return Promise.reject(new Error(`Python is not available in Rhino: ${why}`));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Rhino did not answer. It may still be running the script."));
      }, timeoutMs + ANSWER_GRACE_MS);
      this.pending.set(id, { resolve, reject, timer });
      connection.send({ type: "rhino.python.run", id: randomUUID(), payload: { id, code, timeoutMs } });
    });
  }

  private applyBatch(batch: RhinoBatch): void {
    // A reset replaces the document's objects. Their meshes go one by one: the new objects' meshes were uploaded
    // before this batch and must stay.
    if (batch.reset) this.forgetObjects();
    const accepted: RhinoObject[] = [];
    for (const object of batch.changed) {
      // The mesh is uploaded before the descriptor that names it; one that is not there is not drawn.
      if (object.asset && !this.options.assets.has(object.asset)) {
        this.options.log?.info("rhino object skipped: its mesh was not uploaded", { id: object.id });
        continue;
      }
      this.release(this.objects.get(object.id));
      this.objects.set(object.id, object);
      if (object.asset) this.assetUses.set(object.asset, (this.assetUses.get(object.asset) ?? 0) + 1);
      accepted.push(object);
    }
    for (const id of batch.deleted) {
      this.release(this.objects.get(id));
      this.objects.delete(id);
    }
    this.notDrawn = batch.notDrawn;
    this.sync = batch.sync;
    if (this.mirrored) {
      this.broadcast({ type: "rhino.objects", id: randomUUID(), payload: { ...batch, changed: accepted } });
    }
  }

  /** Lets go of an object's mesh when no object uses it any more. */
  private release(object: RhinoObject | undefined): void {
    if (!object?.asset) return;
    const uses = (this.assetUses.get(object.asset) ?? 1) - 1;
    if (uses > 0) {
      this.assetUses.set(object.asset, uses);
      return;
    }
    this.assetUses.delete(object.asset);
    this.options.assets.remove(object.asset);
  }

  /** Forgets every object and removes the meshes they used. */
  private forgetObjects(): void {
    for (const object of this.objects.values()) if (object.asset) this.options.assets.remove(object.asset);
    this.objects.clear();
    this.assetUses.clear();
    this.notDrawn = EMPTY_NOT_DRAWN;
    this.sync = null;
    this.selected = [];
  }

  /** Forgets everything, and empties the mesh store: no connection, so no mesh belongs to anything. */
  private dropMirror(): void {
    this.forgetObjects();
    this.options.assets.clear();
  }

  private state(): Message {
    const shown = this.mirrored;
    return {
      type: "rhino.state",
      id: randomUUID(),
      payload: {
        connected: this.connected,
        mode: this.options.mode(),
        inUse: this.inUse,
        python: this.python,
        document: this.document,
        objects: shown ? [...this.objects.values()] : [],
        notDrawn: shown ? this.notDrawn : EMPTY_NOT_DRAWN,
        sync: shown ? this.sync : null,
        selection: shown ? this.selected.map((s) => s.id) : [],
      },
    };
  }

  private publishState(): void {
    this.broadcast(this.state());
    const key = `${this.inUse}:${this.python?.state ?? "none"}`;
    if (key !== this.availability) {
      const first = this.availability === null;
      this.availability = key;
      if (!first) this.options.availabilityChanged?.();
    }
  }
}
