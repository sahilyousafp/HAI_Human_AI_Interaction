import { randomUUID } from "node:crypto";
import {
  EMPTY_NOT_DRAWN,
  HOST_DESCRIBE_MAX,
  type HostApiEntry,
  type HostBatch,
  type HostCapabilities,
  type HostComponent,
  type HostHello,
  type HostId,
  type HostLanguage,
  type HostNotDrawn,
  type HostObject,
  type HostRunResult,
  type HostRunStatus,
  type HostSelected,
  type HostSync,
  type Message,
  type MessageOf,
  type TaskScope,
  type ViewMode,
} from "@hai/protocol";
import type { Logger } from "../log.ts";
import { HOST_ADAPTERS, type HostAdapter } from "./adapters.ts";

type Send = (message: Message) => void;

/** The part of a host's mirror asset store the link uses. Each host has its own store. */
export interface MirrorAssets {
  has(id: string): boolean;
  remove(id: string): void;
  clear(): void;
}

export interface HostLinkOptions {
  /** Whether the user lets the agent use this host (Settings > Hosts). */
  switchedOn(): boolean;
  assets: MirrorAssets;
  log?: Logger;
  /** What the agent's host tools depend on changed (connected or gone, able to run or not, switched): sessions restart. */
  availabilityChanged?(): void;
  /** How long after the last selection change the bridge asks the host to describe it. */
  describeDelayMs?: number;
}

/** How long past a script's own time limit the connector may take to answer before the run is given up. */
const ANSWER_GRACE_MS = 5000;
/** How long a capture, a placed image, an API lookup or a description may take before it is given up. */
const REQUEST_TIMEOUT_MS = 15_000;
const DESCRIBE_DELAY_MS = 150;

/** Who asked for a run and what they may change, sent to the connector with the script. */
export interface RunMeta {
  agent?: string;
  title?: string;
  /** The part the agent's task works on: the connector stamps the objects the run adds with it. */
  part?: string;
  /** What the agent's task may change; absent means all of it. */
  claim?: TaskScope;
}

/** A script waiting for its turn, or running. */
interface RunJob {
  code: string;
  language: HostLanguage;
  timeoutMs: number;
  meta: RunMeta;
  resolve(result: HostRunResult): void;
  reject(error: Error): void;
}

/** What the bridge keeps of a connected host. */
export interface HostConnection {
  send: Send;
  close(): void;
  hello: HostHello;
}

type Answer =
  | MessageOf<"host.captured">
  | MessageOf<"host.image.placed">
  | MessageOf<"host.api.result">
  | MessageOf<"host.described">;

/**
 * The bridge's side of one host. Its connector connects as a local client; this holds what it reports (whether it can
 * run code, its document, the objects it meshed, the selection and its description) and tells the viewers, which draw
 * the objects as a read-only mirror, not as part of the scene. It runs the agent's scripts one at a time and relays
 * captures, placed images, API lookups and descriptions.
 */
export class HostLink {
  readonly adapter: HostAdapter;
  private connection: HostConnection | null = null;
  private run: HostRunStatus | null = null;
  private document: string | null = null;
  private readonly objects = new Map<string, HostObject>();
  private readonly assetUses = new Map<string, number>();
  private notDrawn: HostNotDrawn = EMPTY_NOT_DRAWN;
  private sync: HostSync | null = null;
  private selected: HostSelected[] = [];
  private described: HostComponent[] = [];
  private describeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every selection change, so a late description of an older selection is dropped. */
  private selectionVersion = 0;
  /** What the agent's tools depend on, as of the last state sent: at first, not in use and not able to run. */
  private availability = "false:none";
  /** Scripts waiting for their turn: a host runs one script at a time, whatever the number of agents asking. */
  private readonly queue: RunJob[] = [];
  /** The script the host is running for us now. */
  private active: RunJob | null = null;
  private readonly pending = new Map<
    string,
    { resolve(result: HostRunResult): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly requests = new Map<
    string,
    { resolve(answer: Answer): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    readonly id: HostId,
    private readonly options: HostLinkOptions,
    private readonly broadcast: Send,
  ) {
    this.adapter = HOST_ADAPTERS[id];
  }

  get connected(): boolean {
    return this.connection !== null;
  }

  /** Whether the viewers draw this host's objects and the agent may use it: connected and switched on. */
  get inUse(): boolean {
    return this.connected && this.options.switchedOn();
  }

  get runStatus(): HostRunStatus | null {
    return this.run;
  }

  get capabilities(): HostCapabilities | null {
    return this.connection?.hello.capabilities ?? null;
  }

  /** The application's name and version, while connected. */
  get app(): HostHello["app"] | null {
    return this.connection?.hello.app ?? null;
  }

  /** Whether the agent can run code here now. */
  get canRun(): boolean {
    return this.inUse && this.run?.state === "ready";
  }

  /** The mirrored object with this id, if any (the agent's "this" when the user points at it). */
  object(id: string): HostObject | undefined {
    return this.objects.get(id);
  }

  /** Every mirrored object (for listing them by owner, part or tag next to the scene's elements). */
  get mirroredObjects(): HostObject[] {
    return [...this.objects.values()];
  }

  get selection(): HostSelected[] {
    return this.selected;
  }

  /** The selection as the host described it; empty until it has. */
  get components(): HostComponent[] {
    return this.described;
  }

  /** The connector said hello. One that was already connected is replaced. */
  attach(connection: HostConnection): void {
    this.connection?.close();
    this.dropMirror();
    this.connection = connection;
    this.run = connection.hello.run;
    this.document = connection.hello.document;
    this.options.log?.info("host connected", { host: this.id, app: connection.hello.app.version });
    this.publishState();
  }

  /** The connector's connection ended (only the current one counts). */
  detach(connection: HostConnection): void {
    if (this.connection !== connection) return;
    this.connection = null;
    this.run = null;
    this.document = null;
    this.dropMirror();
    const gone = `${this.adapter.label} disconnected`;
    // Waiting scripts first: ending the running one would otherwise send the next to a connection that is gone.
    for (const job of this.queue.splice(0)) job.reject(new Error(`${gone} before the script started.`));
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`${gone} before the script finished.`));
      this.pending.delete(id);
    }
    for (const [id, r] of this.requests) {
      clearTimeout(r.timer);
      r.reject(new Error(`${gone} before it answered.`));
      this.requests.delete(id);
    }
    this.options.log?.info("host disconnected", { host: this.id });
    this.publishState();
  }

  /** The user switched this host on or off in Settings > Hosts. */
  switchChanged(): void {
    this.publishState();
  }

  /** Sends a page what it needs to draw this host. */
  greet(send: Send): void {
    send(this.state());
  }

  /** Handles a message from this host's connector. Returns false for messages a connector may not send. */
  handleFromHost(message: Message): boolean {
    switch (message.type) {
      case "host.status":
        if (message.payload.host !== this.id) return false;
        this.run = message.payload.run;
        this.document = message.payload.document;
        this.publishState();
        return true;
      case "host.objects": {
        if (message.payload.host !== this.id) return false;
        const { host: _host, ...batch } = message.payload;
        this.applyBatch(batch);
        return true;
      }
      case "host.selection":
        if (message.payload.host !== this.id) return false;
        this.selectionChanged(message.payload.objects);
        return true;
      case "host.result": {
        if (message.payload.host !== this.id) return false;
        const { host: _host, ...result } = message.payload;
        const pending = this.pending.get(result.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(result.id);
          pending.resolve(result);
        }
        return true;
      }
      case "host.captured":
      case "host.image.placed":
      case "host.api.result":
      case "host.described": {
        if (message.payload.host !== this.id) return false;
        const request = this.requests.get(message.payload.id);
        if (request) {
          clearTimeout(request.timer);
          this.requests.delete(message.payload.id);
          request.resolve(message as Answer);
        }
        return true;
      }
      case "host.edited":
        // The user's own edit, answered: the pages show the result (the mirror follows by itself) or the reason.
        if (message.payload.host !== this.id) return false;
        this.broadcast(message);
        return true;
      default:
        return false;
    }
  }

  /**
   * The user's own edit of this host's objects, made in HAI: passed to the connector, which applies it as one undo
   * record and answers `host.edited`. A host that is gone or cannot edit is answered here, so the page drops its
   * preview and says why.
   */
  edit(message: MessageOf<"host.edit">): void {
    const { id } = message.payload;
    const refuse = (error: string) =>
      this.broadcast({
        type: "host.edited",
        id: randomUUID(),
        payload: { host: this.id, id, ok: false, error },
      });
    if (!this.connection || !this.inUse) {
      refuse(`${this.adapter.label} is not connected.`);
      return;
    }
    if (!this.capabilities?.edit) {
      refuse(`${this.adapter.label} does not take edits from HAI. Update its connector.`);
      return;
    }
    this.connection.send({ type: "host.edit", id: randomUUID(), payload: message.payload });
  }

  /** Asks the host to redo the step the user undid. */
  redo(): boolean {
    if (!this.connection) return false;
    this.connection.send({ type: "host.redo", id: randomUUID(), payload: { host: this.id } });
    return true;
  }

  /** Selects these objects in the host (a pick in the viewer); empty clears. */
  select(ids: string[]): void {
    this.connection?.send({ type: "host.select", id: randomUUID(), payload: { host: this.id, ids } });
  }

  /** Asks the host to open a file (an absolute path inside the project that the bridge has already checked). */
  open(path: string): boolean {
    if (!this.connection) return false;
    this.connection.send({ type: "host.open", id: randomUUID(), payload: { host: this.id, path } });
    return true;
  }

  /** Asks the host to undo the last script (each run is one undo step). */
  undoRun(): boolean {
    if (!this.connection) return false;
    this.connection.send({ type: "host.undo", id: randomUUID(), payload: { host: this.id } });
    return true;
  }

  /** Why a script cannot run here now, or null. */
  unavailable(): string | null {
    const { label, connectHint } = this.adapter;
    if (!this.connection) return `${label} is not connected. ${connectHint}`;
    if (!this.options.switchedOn()) return `${label} is switched off in Settings > Hosts.`;
    if (this.run?.state === "ready") return null;
    const why = this.run?.state === "unavailable" ? this.run.reason : "its status is not known";
    return `${label} cannot run code now: ${why}`;
  }

  /**
   * Runs a script in the open document; rejects if the host is not connected, goes away, or does not answer. Scripts
   * take their turns, in the order they were asked: the time limit starts when the host gets the script, not when it
   * was asked for. `signal` ends the wait of a script that has not started yet; one already running keeps the host
   * busy until it answers, so the next does not start on top of it.
   */
  runCode(
    code: string,
    timeoutMs: number,
    meta: RunMeta = {},
    signal?: AbortSignal,
    language: HostLanguage = this.adapter.language,
  ): Promise<HostRunResult> {
    const unavailable = this.unavailable();
    if (unavailable) return Promise.reject(new Error(unavailable));
    return new Promise((resolve, reject) => {
      const job: RunJob = { code, language, timeoutMs, meta, resolve, reject };
      const stopped = () => {
        const queued = this.queue.indexOf(job);
        if (queued >= 0) this.queue.splice(queued, 1);
        reject(new Error("The run was stopped."));
      };
      if (signal?.aborted) return stopped();
      signal?.addEventListener("abort", stopped, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  /** The host's own viewport, as an uploaded PNG asset. */
  async capture(
    view: ViewMode | undefined,
    width: number,
    height: number,
  ): Promise<{ ok: true; asset: string; durationMs: number } | { ok: false; error: string }> {
    if (!this.capabilities?.capture)
      return { ok: false, error: `${this.adapter.label} cannot capture its view.` };
    const answer = await this.request("host.capture", (id) => ({
      host: this.id,
      id,
      ...(view ? { view } : {}),
      width,
      height,
    }));
    if (answer.type !== "host.captured") return { ok: false, error: "Unexpected answer." };
    const p = answer.payload;
    return p.ok && p.asset
      ? { ok: true, asset: p.asset, durationMs: p.durationMs }
      : { ok: false, error: p.error ?? "The capture failed." };
  }

  /** Places an image (an absolute path the bridge has checked) on a plane, as one undo step. */
  async placeImage(input: {
    path: string;
    origin: [number, number, number];
    normal: [number, number, number];
    widthMm: number;
    heightMm?: number;
    agent?: string;
    title?: string;
  }): Promise<{ ok: true; objectId?: string } | { ok: false; error: string }> {
    if (!this.capabilities?.placeImage)
      return { ok: false, error: `${this.adapter.label} cannot place images.` };
    const answer = await this.request("host.image.place", (id) => ({ host: this.id, id, ...input }));
    if (answer.type !== "host.image.placed") return { ok: false, error: "Unexpected answer." };
    const p = answer.payload;
    return p.ok
      ? { ok: true, ...(p.objectId ? { objectId: p.objectId } : {}) }
      : { ok: false, error: p.error ?? "" };
  }

  /** Looks up the host's scripting API. */
  async api(query: string): Promise<{ entries: HostApiEntry[]; truncated: boolean; partial: boolean }> {
    if (!this.capabilities?.apiLookup) throw new Error(`${this.adapter.label} cannot look up its API.`);
    const answer = await this.request("host.api", (id) => ({ host: this.id, id, query }));
    if (answer.type !== "host.api.result") throw new Error("Unexpected answer.");
    const { entries, truncated, partial } = answer.payload;
    return { entries, truncated, partial };
  }

  /** Describes these objects: what they are, how big, of what, and their own properties. */
  async describe(ids: string[]): Promise<HostComponent[]> {
    if (!this.capabilities?.describe) throw new Error(`${this.adapter.label} cannot describe its objects.`);
    if (ids.length === 0) return [];
    const answer = await this.request("host.describe", (id) => ({
      host: this.id,
      id,
      ids: ids.slice(0, HOST_DESCRIBE_MAX),
    }));
    if (answer.type !== "host.described") throw new Error("Unexpected answer.");
    return answer.payload.components;
  }

  private request<T extends "host.capture" | "host.image.place" | "host.api" | "host.describe">(
    type: T,
    payload: (id: string) => MessageOf<T>["payload"],
  ): Promise<Answer> {
    const connection = this.connection;
    if (!connection) return Promise.reject(new Error(`${this.adapter.label} is not connected.`));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error(`${this.adapter.label} did not answer.`));
      }, REQUEST_TIMEOUT_MS);
      this.requests.set(id, { resolve, reject, timer });
      connection.send({ type, id: randomUUID(), payload: payload(id) } as Message);
    });
  }

  /** Sends the next waiting script when the host is free. */
  private pump(): void {
    if (this.active) return;
    const job = this.queue.shift();
    if (!job) return;
    const connection = this.connection;
    if (!connection) {
      job.reject(new Error(`${this.adapter.label} is not connected. ${this.adapter.connectHint}`));
      this.pump();
      return;
    }
    this.active = job;
    const id = randomUUID();
    const done = () => {
      this.active = null;
      this.pump();
    };
    const timer = setTimeout(() => {
      this.pending.delete(id);
      job.reject(new Error(`${this.adapter.label} did not answer. It may still be running the script.`));
      done();
    }, job.timeoutMs + ANSWER_GRACE_MS);
    this.pending.set(id, {
      resolve: (result) => {
        job.resolve(result);
        done();
      },
      reject: (error) => {
        job.reject(error);
        done();
      },
      timer,
    });
    const { agent, title, part, claim } = job.meta;
    connection.send({
      type: "host.run",
      id: randomUUID(),
      payload: {
        host: this.id,
        id,
        language: job.language,
        code: job.code,
        timeoutMs: job.timeoutMs,
        ...(agent ? { agent } : {}),
        ...(title ? { title: title.slice(0, 80) } : {}),
        ...(part ? { part } : {}),
        ...(claim ? { claim } : {}),
      },
    });
  }

  /** The selection changed: tell the viewers now, and describe it once it settles. */
  private selectionChanged(objects: HostSelected[]): void {
    this.selected = objects;
    this.described = [];
    const version = ++this.selectionVersion;
    if (this.inUse) this.broadcastSelection();
    if (this.describeTimer) clearTimeout(this.describeTimer);
    this.describeTimer = null;
    if (objects.length === 0 || !this.capabilities?.describe) return;
    this.describeTimer = setTimeout(() => {
      this.describeTimer = null;
      this.describe(objects.map((o) => o.id)).then(
        (components) => {
          if (version !== this.selectionVersion) return;
          this.described = components;
          if (this.inUse) this.broadcastSelection();
        },
        (error: Error) =>
          this.options.log?.info("host selection not described", { host: this.id, error: error.message }),
      );
    }, this.options.describeDelayMs ?? DESCRIBE_DELAY_MS);
  }

  private broadcastSelection(): void {
    this.broadcast({
      type: "host.selection",
      id: randomUUID(),
      payload: {
        host: this.id,
        objects: this.selected,
        ...(this.described.length > 0 ? { components: this.described } : {}),
      },
    });
  }

  private applyBatch(batch: HostBatch): void {
    // A reset replaces the document's objects. Their meshes go one by one: the new objects' meshes were uploaded
    // before this batch and must stay.
    if (batch.reset) this.forgetObjects();
    const accepted: HostObject[] = [];
    for (const object of batch.changed) {
      // The mesh is uploaded before the descriptor that names it; one that is not there is not drawn.
      if (object.asset && !this.options.assets.has(object.asset)) {
        this.options.log?.info("host object skipped: its mesh was not uploaded", {
          host: this.id,
          id: object.id,
        });
        continue;
      }
      // The new use first: a block's placements share a mesh, and a moved placement names the one it already has.
      if (object.asset) this.assetUses.set(object.asset, (this.assetUses.get(object.asset) ?? 0) + 1);
      this.release(this.objects.get(object.id));
      this.objects.set(object.id, object);
      accepted.push(object);
    }
    for (const id of batch.deleted) {
      this.release(this.objects.get(id));
      this.objects.delete(id);
    }
    this.notDrawn = batch.notDrawn;
    this.sync = batch.sync;
    if (this.inUse) {
      this.broadcast({
        type: "host.objects",
        id: randomUUID(),
        payload: { host: this.id, ...batch, changed: accepted },
      });
    }
  }

  /** Lets go of an object's mesh when no object uses it any more. */
  private release(object: HostObject | undefined): void {
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
    this.described = [];
  }

  /** Forgets everything, and empties this host's mesh store: no connection, so no mesh belongs to anything. */
  private dropMirror(): void {
    if (this.describeTimer) clearTimeout(this.describeTimer);
    this.describeTimer = null;
    this.forgetObjects();
    this.options.assets.clear();
  }

  private state(): Message {
    const shown = this.inUse;
    return {
      type: "host.state",
      id: randomUUID(),
      payload: {
        host: this.id,
        switchedOn: this.options.switchedOn(),
        connected: this.connected,
        app: this.app,
        run: this.run,
        capabilities: this.capabilities,
        document: this.document,
        objects: shown ? [...this.objects.values()] : [],
        notDrawn: shown ? this.notDrawn : EMPTY_NOT_DRAWN,
        sync: shown ? this.sync : null,
        selection: shown ? this.selected.map((s) => s.id) : [],
        components: shown ? this.described : [],
      },
    };
  }

  private publishState(): void {
    this.broadcast(this.state());
    const key = `${this.inUse}:${this.run?.state ?? "none"}`;
    if (key !== this.availability) {
      this.availability = key;
      this.options.availabilityChanged?.();
    }
  }
}
