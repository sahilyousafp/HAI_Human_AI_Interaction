import {
  EMPTY_NOT_DRAWN,
  HOST_IDS,
  type HostApp,
  type HostCapabilities,
  type HostComponent,
  type HostId,
  type HostNotDrawn,
  type HostObject,
  type HostRunStatus,
  type HostSync,
  type Message,
  type Point3Mm,
} from "@hai/protocol";
import { withoutBackdrops } from "../viewer/backdrop.ts";
import { LatencyTracker } from "../viewer/latency.ts";

/**
 * A block placed at least this many times is planting, furniture and the like: its placements are drawn together, and
 * the view is not framed on them.
 */
export const REPEATED_PLACEMENTS = 8;

/** How many placements each block's shared mesh has. */
export function placementsByAsset(objects: Iterable<HostObject>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { asset, transform } of objects) {
    if (asset && transform) counts.set(asset, (counts.get(asset) ?? 0) + 1);
  }
  return counts;
}

/** Whether an object is a placement of a block used many times, given the counts of `placementsByAsset`. */
export function isRepeatedPlacement(object: HostObject, placements: Map<string, number>): boolean {
  return (
    object.asset !== null &&
    object.transform !== undefined &&
    (placements.get(object.asset) ?? 0) >= REPEATED_PLACEMENTS
  );
}

const diagonal = ({ bounds }: HostObject): number =>
  Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);

export interface MirrorState {
  /** The user lets the agent use this host (Settings > Hosts). */
  switchedOn: boolean;
  connected: boolean;
  /** The application and its version, while connected. */
  app: HostApp | null;
  /** Whether the agent can run code here now. */
  run: HostRunStatus | null;
  capabilities: HostCapabilities | null;
  document: string | null;
  /** The mirrored objects; a new array whenever any of them changes. */
  objects: HostObject[];
  notDrawn: HostNotDrawn;
  /** How far the first sync of a document has got; null once it is in. */
  sync: HostSync | null;
  /** The selected objects' ids. */
  selection: string[];
  /** The selection as the host describes it, once it has. */
  components: HostComponent[];
  /** Counts every change, so views redraw. */
  version: number;
  /** Counts the times a whole document has arrived (a sync finished), so the view can frame it once. */
  synced: number;
}

/**
 * What the app's chrome shows of a host (its chip, the settings page): everything but the objects, the selection and
 * its description, which change with every edit and are drawn by the viewer alone.
 */
export type MirrorStatus = Pick<
  MirrorState,
  "switchedOn" | "connected" | "app" | "run" | "capabilities" | "document" | "notDrawn" | "sync"
>;

const pickStatus = (s: MirrorState): MirrorStatus => ({
  switchedOn: s.switchedOn,
  connected: s.connected,
  app: s.app,
  run: s.run,
  capabilities: s.capabilities,
  document: s.document,
  notDrawn: s.notDrawn,
  sync: s.sync,
});

const sameStatus = (a: MirrorStatus, b: MirrorStatus): boolean =>
  a.switchedOn === b.switchedOn &&
  a.connected === b.connected &&
  a.document === b.document &&
  JSON.stringify([a.app, a.run, a.capabilities, a.sync, a.notDrawn]) ===
    JSON.stringify([b.app, b.run, b.capabilities, b.sync, b.notDrawn]);

const INITIAL: MirrorState = {
  switchedOn: true,
  connected: false,
  app: null,
  run: null,
  capabilities: null,
  document: null,
  objects: [],
  notDrawn: EMPTY_NOT_DRAWN,
  sync: null,
  selection: [],
  components: [],
  version: 0,
  synced: 0,
};

/** A batch waiting to be seen on screen: when the connector sent it, and the meshes it needs before it can be drawn. */
interface Waiting {
  changedAt: number;
  assets: string[];
}

const newId = () => crypto.randomUUID();

type Box = { min: Point3Mm; max: Point3Mm };

function boxOf(objects: Iterable<HostObject>): Box | null {
  const min: Point3Mm = [Infinity, Infinity, Infinity];
  const max: Point3Mm = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const { bounds } of objects) {
    any = true;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, bounds.min[k] as number);
      max[k] = Math.max(max[k] as number, bounds.max[k] as number);
    }
  }
  return any ? { min, max } : null;
}

/**
 * The browser's copy of what one host's connector reports: whether it is connected and switched on, what it can do,
 * and the objects of its open document, kept apart from the HAI scene. It measures how long a change in the host takes
 * to be drawn here (from the connector's `changedAt` to the frame that has the new mesh), and sends picks back so the
 * host selects.
 */
export class HostMirror {
  private state = INITIAL;
  private status = pickStatus(INITIAL);
  private readonly byId = new Map<string, HostObject>();
  private readonly listeners = new Set<() => void>();
  private waiting: Waiting[] = [];
  private readonly latency = new LatencyTracker(3000);

  constructor(
    readonly host: HostId,
    private readonly send: (message: Message) => boolean,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MirrorState => this.state;

  /** The status the chrome shows; the same object until one of its fields changes, so an edit redraws none of it. */
  getStatus = (): MirrorStatus => this.status;

  has(id: string): boolean {
    return this.byId.has(id);
  }

  object(id: string): HostObject | undefined {
    return this.byId.get(id);
  }

  /** The bounding box of every mirrored object, millimetres, or null when there are none. */
  bounds(): Box | null {
    return boxOf(this.byId.values());
  }

  /** The box to frame when a model arrives: what it is about, without its planting or a backdrop such as a sky dome. */
  framingBounds(): Box | null {
    const all = [...this.byId.values()];
    const placements = placementsByAsset(all);
    const main = all.filter((o) => !isRepeatedPlacement(o, placements));
    const framed = withoutBackdrops(main, diagonal);
    return boxOf(framed.length > 0 ? framed : all);
  }

  /** Handles a bridge message about this host; returns false for anything else. */
  handle(message: Message): boolean {
    switch (message.type) {
      case "host.state": {
        const p = message.payload;
        if (p.host !== this.host) return false;
        this.byId.clear();
        for (const object of p.objects) this.byId.set(object.id, object);
        this.waiting = [];
        this.update({
          switchedOn: p.switchedOn,
          connected: p.connected,
          app: p.app,
          run: p.run,
          capabilities: p.capabilities,
          document: p.document,
          objects: p.objects,
          notDrawn: p.notDrawn,
          sync: p.sync,
          selection: p.selection,
          components: p.components,
          synced: p.objects.length > 0 && p.sync === null ? this.state.synced + 1 : this.state.synced,
        });
        return true;
      }
      case "host.objects": {
        const batch = message.payload;
        if (batch.host !== this.host) return false;
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
          components: this.state.components.filter((c) => this.byId.has(c.id)),
          synced: finished ? this.state.synced + 1 : this.state.synced,
        });
        return true;
      }
      case "host.selection":
        if (message.payload.host !== this.host) return false;
        this.update({
          selection: message.payload.objects.map((o) => o.id),
          components: message.payload.components ?? [],
        });
        return true;
      default:
        return false;
    }
  }

  /** A pick in the viewer: the host selects these objects (an empty list clears), and the highlight follows at once. */
  select(ids: string[]): boolean {
    if (!ids.every((id) => this.byId.has(id))) return false;
    this.update({ selection: ids, components: [] });
    this.send({ type: "host.select", id: newId(), payload: { host: this.host, ids } });
    return true;
  }

  /** Another host was picked: this one's highlight goes at once (the bridge clears its selection in the host). */
  clearLocally(): void {
    if (this.state.selection.length > 0) this.update({ selection: [], components: [] });
  }

  /**
   * A frame was drawn. Every batch whose meshes have all arrived is now on screen: the time since the connector sent it
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

  /** The 90th percentile of the last few seconds of "change in the host to drawn here", or null. */
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

/**
 * Every host's mirror. Messages go to the mirror of the host they name; a pick goes to the host that owns what was
 * picked, and clears the others, so the selection is always one host's.
 */
export class HostMirrors {
  readonly byHost: Record<HostId, HostMirror>;

  constructor(send: (message: Message) => boolean) {
    this.byHost = Object.fromEntries(HOST_IDS.map((id) => [id, new HostMirror(id, send)])) as Record<
      HostId,
      HostMirror
    >;
  }

  get all(): HostMirror[] {
    return HOST_IDS.map((id) => this.byHost[id]);
  }

  /** Calls `listener` when any host's mirror changes. */
  subscribe = (listener: () => void): (() => void) => {
    const offs = this.all.map((m) => m.subscribe(listener));
    return () => {
      for (const off of offs) off();
    };
  };

  handle(message: Message): boolean {
    for (const mirror of this.all) if (mirror.handle(message)) return true;
    return false;
  }

  /** The mirror whose host has this object, if any. */
  owner(id: string): HostMirror | undefined {
    return this.all.find((m) => m.has(id));
  }

  has(id: string): boolean {
    return this.owner(id) !== undefined;
  }

  object(id: string): (HostObject & { host: HostId }) | undefined {
    const owner = this.owner(id);
    const object = owner?.object(id);
    return owner && object ? { ...object, host: owner.host } : undefined;
  }

  /** The ids selected in any host. */
  get selection(): string[] {
    return this.all.flatMap((m) => m.getSnapshot().selection);
  }

  /**
   * A pick in the viewer: objects of one host select in it, and the other hosts clear. Returns false when the ids are
   * not all one host's objects (the pick is then the HAI scene's).
   */
  select(ids: string[]): boolean {
    const owner = ids.length > 0 ? this.owner(ids[0] as string) : undefined;
    if (!owner?.select(ids)) return false;
    for (const other of this.all) if (other !== owner) other.clearLocally();
    return true;
  }

  /** A tap on empty space: every host's selection clears. */
  clear(): void {
    for (const mirror of this.all) if (mirror.getSnapshot().selection.length > 0) mirror.select([]);
  }

  /** How many whole documents have arrived, across hosts, so the view frames each once. */
  get synced(): number {
    return this.all.reduce((sum, m) => sum + m.getSnapshot().synced, 0);
  }

  /** The box to frame when a model arrives: what every host's model is about. */
  framingBounds(): Box | null {
    const boxes = this.all.flatMap((m) => {
      const box = m.framingBounds();
      return box ? [box] : [];
    });
    if (boxes.length === 0) return null;
    return {
      min: [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k] as number))) as Point3Mm,
      max: [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k] as number))) as Point3Mm,
    };
  }
}
