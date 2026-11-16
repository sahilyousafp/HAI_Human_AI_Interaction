import type { HostId } from "@hai/protocol";

/** Where an edit the user made was made: HAI's scene, or a host. */
export type EditPlace = { kind: "scene" } | { kind: "host"; host: HostId };

/** How the history takes a step back or forward in each place; false when it could not be sent. */
export interface EditPlaces {
  undoScene(): boolean;
  redoScene(): boolean;
  undoHost(host: HostId): boolean;
  redoHost(host: HostId): boolean;
}

/** How many of the user's edits the history remembers. */
export const HISTORY_LIMIT = 200;

/**
 * The order of the user's own edits, wherever they were made, so that Undo takes back the last one: a scene edit with
 * the scene's undo, a host edit with that host's (each host edit is one undo step there). An agent's run is not in it:
 * it has its own Undo, in its run report. With nothing remembered (a page opened after the edits) Undo and Redo go to
 * the scene, as they always did.
 */
export class EditHistory {
  private readonly done: EditPlace[] = [];
  private readonly undone: EditPlace[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly places: EditPlaces) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The user made an edit here. What was undone can no longer be redone, as in any editor. */
  record(place: EditPlace): void {
    this.done.push(place);
    if (this.done.length > HISTORY_LIMIT) this.done.shift();
    this.undone.length = 0;
    this.notify();
  }

  /** Whether the last edit the user made, still to be undone, was in a host. */
  get hostUndo(): HostId | null {
    const last = this.done.at(-1);
    return last?.kind === "host" ? last.host : null;
  }

  /** Whether the next redo is in a host. */
  get hostRedo(): HostId | null {
    const next = this.undone.at(-1);
    return next?.kind === "host" ? next.host : null;
  }

  undo(): boolean {
    const last = this.done.at(-1);
    const sent = last?.kind === "host" ? this.places.undoHost(last.host) : this.places.undoScene();
    if (sent && last) {
      this.done.pop();
      this.undone.push(last);
      this.notify();
    }
    return sent;
  }

  redo(): boolean {
    const next = this.undone.at(-1);
    const sent = next?.kind === "host" ? this.places.redoHost(next.host) : this.places.redoScene();
    if (sent && next) {
      this.undone.pop();
      this.done.push(next);
      this.notify();
    }
    return sent;
  }

  /** A host's document changed (another file, or the host was closed): its steps can no longer be taken back here. */
  forgetHost(host: HostId): void {
    const keep = (p: EditPlace) => p.kind !== "host" || p.host !== host;
    const before = this.done.length + this.undone.length;
    this.done.splice(0, this.done.length, ...this.done.filter(keep));
    this.undone.splice(0, this.undone.length, ...this.undone.filter(keep));
    if (this.done.length + this.undone.length !== before) this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
