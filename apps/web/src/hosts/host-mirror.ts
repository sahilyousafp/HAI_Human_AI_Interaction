import {
  EMPTY_NOT_DRAWN,
  HOST_IDS,
  HOST_INFO,
  type HostApp,
  type HostCapabilities,
  type HostComponent,
  type HostEditOp,
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
  /** The user's edit, drawn before the host has made it: a drag in progress, or an edit waiting for its batch. */
  preview: MirrorPreview | null;
  /** What the agent changed for the last request about a selection, shown until the next selection. */
  changed: string[];
}

/**
 * An edit drawn ahead of the host: these objects moved by a matrix (4 x 4, row by row, millimetres) on top of their
 * placement, or taken out of the view (a delete).
 */
export type MirrorPreview = { ids: string[]; matrix: number[] } | { ids: string[]; deleted: true };

/** How an edit sent to the host ended. */
export type HostEditOutcome = { ok: true } | { ok: false; error: string };

/** How long an edit's preview waits for the host to answer and send the result, milliseconds. */
export const EDIT_TIMEOUT_MS = 5000;

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
  preview: null,
  changed: [],
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
  private readonly changeListeners = new Set<(ids: string[]) => void>();
  /** The edit sent and not yet drawn: its id, its answer once in, and what ends it. */
  private inFlight: {
    id: string;
    answered: boolean;
    timer: ReturnType<typeof setTimeout>;
    resolve: (outcome: HostEditOutcome) => void;
  } | null = null;

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
        this.settle({
          ok: false,
          error: `${this.label()} sent its whole model again before the edit landed.`,
        });
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
          preview: null,
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
        // The edit's result has arrived: the objects are drawn where the host put them, so the preview goes.
        const landed =
          this.inFlight !== null &&
          this.state.preview !== null &&
          (batch.reset ||
            this.state.preview.ids.some(
              (id) => batch.deleted.includes(id) || batch.changed.some((o) => o.id === id),
            ));
        if (landed) this.settle({ ok: true });
        if (batch.changed.length > 0) {
          const ids = batch.changed.map((o) => o.id);
          for (const listener of this.changeListeners) listener(ids);
        }
        this.update({
          objects: [...this.byId.values()],
          notDrawn: batch.notDrawn,
          sync: batch.sync,
          selection: this.state.selection.filter((id) => this.byId.has(id)),
          components: this.state.components.filter((c) => this.byId.has(c.id)),
          synced: finished ? this.state.synced + 1 : this.state.synced,
          ...(landed ? { preview: null } : {}),
        });
        return true;
      }
      case "host.edited": {
        const p = message.payload;
        if (p.host !== this.host) return false;
        const edit = this.inFlight;
        if (!edit || edit.id !== p.id) return true;
        if (!p.ok) {
          this.settle({ ok: false, error: p.error ?? `${this.label()} did not make the change.` });
          this.update({ preview: null });
        } else {
          // Made: the preview holds until the batch with the objects arrives (or the time runs out quietly).
          edit.answered = true;
          edit.resolve({ ok: true });
        }
        return true;
      }
      case "host.selection":
        if (message.payload.host !== this.host) return false;
        this.update({
          selection: message.payload.objects.map((o) => o.id),
          components: message.payload.components ?? [],
          ...(message.payload.objects.length > 0 ? { changed: [] } : {}),
        });
        return true;
      default:
        return false;
    }
  }

  /** A pick in the viewer: the host selects these objects (an empty list clears), and the highlight follows at once. */
  select(ids: string[]): boolean {
    if (!ids.every((id) => this.byId.has(id))) return false;
    this.update({ selection: ids, components: [], ...(ids.length > 0 ? { changed: [] } : {}) });
    this.send({ type: "host.select", id: newId(), payload: { host: this.host, ids } });
    return true;
  }

  /** Calls `listener` with the ids of the objects each batch adds or changes, whoever changed them. */
  onChanges(listener: (ids: string[]) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Shows these objects as changed for the user's last request (those still here), until the next selection. */
  showChanged(ids: string[]): void {
    this.update({ changed: ids.filter((id) => this.byId.has(id)) });
  }

  /** Shows an edit being made (a drag), or with null stops showing it. Ignored while an edit is on its way. */
  preview(ids: string[], matrix: number[] | null): void {
    if (this.inFlight) return;
    this.update({ preview: matrix && ids.length > 0 ? { ids, matrix } : null });
  }

  /**
   * The user's edit of this host's objects: sent to the host, which makes it one undo step there. Its preview is drawn
   * until the host's batch with the objects arrives, so nothing jumps back; on a refusal, or with no answer within
   * `EDIT_TIMEOUT_MS`, the preview goes and the outcome says why. One edit at a time: a second waits for nothing and
   * is refused.
   */
  edit(label: string, op: HostEditOp): Promise<HostEditOutcome> {
    if (this.inFlight) return Promise.resolve({ ok: false, error: "The last change is still on its way." });
    const state = this.state;
    if (!state.connected) return Promise.resolve({ ok: false, error: `${this.label()} is not connected.` });
    if (!state.capabilities?.edit)
      return Promise.resolve({
        ok: false,
        error: `${this.label()} does not take edits from HAI. Update its connector.`,
      });
    const id = newId();
    const sent = this.send({ type: "host.edit", id: newId(), payload: { host: this.host, id, label, op } });
    if (!sent) return Promise.resolve({ ok: false, error: "The bridge is not connected." });
    return new Promise<HostEditOutcome>((resolve) => {
      // No answer in time: the preview goes and the edit fails. An edit that was made but whose batch never touched
      // the objects ends quietly the same way, its answer already given.
      const timer = setTimeout(() => {
        this.settle({
          ok: false,
          error: `${this.label()} did not answer within ${EDIT_TIMEOUT_MS / 1000} seconds.`,
        });
        if (this.state.preview) this.update({ preview: null });
      }, EDIT_TIMEOUT_MS);
      this.inFlight = { id, answered: false, timer, resolve };
      this.update({
        preview: op.op === "delete" ? { ids: op.ids, deleted: true } : { ids: op.ids, matrix: op.matrix },
      });
    });
  }

  /** Takes back the last step in the host (each edit made from HAI is one); false when it could not be sent. */
  undo(): boolean {
    return (
      this.state.connected && this.send({ type: "host.undo", id: newId(), payload: { host: this.host } })
    );
  }

  /** Makes again the step the host last took back. */
  redo(): boolean {
    return (
      this.state.connected && this.send({ type: "host.redo", id: newId(), payload: { host: this.host } })
    );
  }

  /** Ends the edit on its way, answering it if it has not been. */
  private settle(outcome: HostEditOutcome): void {
    const edit = this.inFlight;
    if (!edit) return;
    clearTimeout(edit.timer);
    this.inFlight = null;
    if (!edit.answered) edit.resolve(outcome);
  }

  private label(): string {
    return HOST_INFO[this.host].label;
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

  /** The user's edit of objects of one host, sent to that host. */
  edit(host: HostId, label: string, op: HostEditOp): Promise<HostEditOutcome> {
    return this.byHost[host].edit(label, op);
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
