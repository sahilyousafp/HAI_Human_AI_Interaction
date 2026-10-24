import {
  EMPTY_NOT_DRAWN,
  type Message,
  type ModellingInUse,
  type ModellingMode,
  type Point3Mm,
  type RhinoNotDrawn,
  type RhinoObject,
  type RhinoPythonStatus,
  type RhinoSync,
} from "@hai/protocol";
import { LatencyTracker } from "../viewer/latency.ts";

export interface MirrorState {
  connected: boolean;
  mode: ModellingMode;
  inUse: ModellingInUse;
  python: RhinoPythonStatus | null;
  document: string | null;
  /** The mirrored Rhino objects; a new array whenever any of them changes. */
  objects: RhinoObject[];
  notDrawn: RhinoNotDrawn;
  /** How far the first sync of a document has got; null once it is in. */
  sync: RhinoSync | null;
  /** The selected Rhino objects' ids. */
  selection: string[];
  /** Counts every change, so views redraw. */
  version: number;
  /** Counts the times a whole document has arrived (a sync finished), so the view can frame it once. */
  synced: number;
}

/**
 * What the app's chrome shows of Rhino (the pill, the settings page): everything but the objects and the selection,
 * which change with every edit in Rhino and are drawn by the viewer alone.
 */
export type MirrorStatus = Pick<
  MirrorState,
  "connected" | "mode" | "inUse" | "python" | "document" | "notDrawn" | "sync"
>;

const pickStatus = (s: MirrorState): MirrorStatus => ({
  connected: s.connected,
  mode: s.mode,
  inUse: s.inUse,
  python: s.python,
  document: s.document,
  notDrawn: s.notDrawn,
  sync: s.sync,
});

const sameStatus = (a: MirrorStatus, b: MirrorStatus): boolean =>
  a.connected === b.connected &&
  a.mode === b.mode &&
  a.inUse === b.inUse &&
  a.document === b.document &&
  JSON.stringify(a.python) === JSON.stringify(b.python) &&
  JSON.stringify(a.sync) === JSON.stringify(b.sync) &&
  JSON.stringify(a.notDrawn) === JSON.stringify(b.notDrawn);

const INITIAL: MirrorState = {
  connected: false,
  mode: "auto",
  inUse: "python",
  python: null,
  document: null,
  objects: [],
  notDrawn: EMPTY_NOT_DRAWN,
  sync: null,
  selection: [],
  version: 0,
  synced: 0,
};

/** A batch waiting to be seen on screen: when the plugin sent it, and the meshes it needs before it can be drawn. */
interface Waiting {
  changedAt: number;
  assets: string[];
}

const newId = () => crypto.randomUUID();

/**
 * The browser's copy of what the Rhino plugin reports: whether Rhino is connected, how the agent models, and the
 * objects of its open document, kept apart from the HAI scene. It measures how long a change in Rhino takes to be drawn
 * here (from the plugin's `changedAt` to the frame that has the new mesh), and sends picks back so Rhino selects.
 */
export class RhinoMirror {
  private state = INITIAL;
  private status = pickStatus(INITIAL);
  private readonly byId = new Map<string, RhinoObject>();
  private readonly listeners = new Set<() => void>();
  private waiting: Waiting[] = [];
  private readonly latency = new LatencyTracker(3000);

  constructor(private readonly send: (message: Message) => boolean) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MirrorState => this.state;

  /** The status the chrome shows; the same object until one of its fields changes, so an edit in Rhino redraws none of it. */
  getStatus = (): MirrorStatus => this.status;

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** The bounding box of every mirrored object, millimetres, or null when there are none. */
  bounds(): { min: Point3Mm; max: Point3Mm } | null {
    if (this.byId.size === 0) return null;
    const min: Point3Mm = [Infinity, Infinity, Infinity];
    const max: Point3Mm = [-Infinity, -Infinity, -Infinity];
    for (const { bounds } of this.byId.values()) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, bounds.min[k] as number);
        max[k] = Math.max(max[k] as number, bounds.max[k] as number);
      }
    }
    return { min, max };
  }

  /** Handles a bridge message; returns false if it was not about Rhino. */
  handle(message: Message): boolean {
    switch (message.type) {
      case "rhino.state": {
        const p = message.payload;
        this.byId.clear();
        for (const object of p.objects) this.byId.set(object.id, object);
        this.waiting = [];
        this.update({
          connected: p.connected,
          mode: p.mode,
          inUse: p.inUse,
          python: p.python,
          document: p.document,
          objects: p.objects,
          notDrawn: p.notDrawn,
          sync: p.sync,
          selection: p.selection,
          synced: p.objects.length > 0 && p.sync === null ? this.state.synced + 1 : this.state.synced,
        });
        return true;
      }
      case "rhino.objects": {
        const batch = message.payload;
        if (batch.reset) this.byId.clear();
        for (const object of batch.changed) this.byId.set(object.id, object);
        for (const id of batch.deleted) this.byId.delete(id);
        this.waiting.push({
          changedAt: batch.changedAt,
          assets: batch.changed.flatMap((o) => (o.asset ? [o.asset] : [])),
        });
        const finished = batch.sync === null && (batch.reset || this.state.sync !== null);
        this.update({
          objects: [...this.byId.values()],
          notDrawn: batch.notDrawn,
          sync: batch.sync,
          selection: this.state.selection.filter((id) => this.byId.has(id)),
          synced: finished ? this.state.synced + 1 : this.state.synced,
        });
        return true;
      }
      case "rhino.selection":
        this.update({ selection: message.payload.objects.map((o) => o.id) });
        return true;
      default:
        return false;
    }
  }

  /** A pick in the viewer: Rhino selects these objects (an empty list clears), and the highlight follows at once. */
  select(ids: string[]): boolean {
    const mine = ids.filter((id) => this.byId.has(id));
    if (mine.length !== ids.length) return false;
    this.update({ selection: ids });
    this.send({ type: "rhino.select", id: newId(), payload: { ids } });
    return true;
  }

  /**
   * A frame was drawn. Every batch whose meshes have all arrived is now on screen: the time since the plugin sent it
   * is how long the change took. Returns whether anything is still waiting for a mesh.
   */
  frameDrawn(
    meshReady: (asset: string) => boolean,
    now = performance.timeOrigin + performance.now(),
  ): boolean {
    const still: Waiting[] = [];
    for (const batch of this.waiting) {
      if (batch.assets.every(meshReady)) this.latency.add(now - batch.changedAt);
      else still.push(batch);
    }
    const changed = still.length !== this.waiting.length;
    this.waiting = still;
    if (changed) this.notify();
    return still.length > 0;
  }

  /** The 90th percentile of the last few seconds of "change in Rhino to drawn here", or null. */
  latencyP90(now?: number): number | null {
    return this.latency.p90(now);
  }

  private update(partial: Partial<MirrorState>): void {
    this.state = { ...this.state, ...partial, version: this.state.version + 1 };
    const status = pickStatus(this.state);
    if (!sameStatus(status, this.status)) this.status = status;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
