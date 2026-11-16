import { HOST_IDS, type HostId, type HostObject, type Message } from "@hai/protocol";
import type { Logger } from "../log.ts";
import { HostLink, type MirrorAssets } from "./host-link.ts";

type Send = (message: Message) => void;

export interface HostRegistryOptions {
  /** Whether the user lets the agent use this host (Settings > Hosts). */
  switchedOn(host: HostId): boolean;
  /** Each host's own mirror asset store, so one host going away clears only its meshes. */
  assets(host: HostId): MirrorAssets;
  log?: Logger;
  /** The hosts the agent can use changed: its sessions restart so their tools follow. */
  availabilityChanged?(): void;
  describeDelayMs?: number;
}

/** A mirrored object with the host it belongs to. */
export type MirroredObject = HostObject & { host: HostId };

/**
 * Every host the bridge knows, connected or not: one link each. Messages from pages are routed by the host they name;
 * a pick in one host clears the selection in the others, so "this" is always one host's.
 */
export class HostRegistry {
  private readonly links: Record<HostId, HostLink>;

  constructor(options: HostRegistryOptions, broadcast: Send) {
    this.links = Object.fromEntries(
      HOST_IDS.map((id) => [
        id,
        new HostLink(
          id,
          {
            switchedOn: () => options.switchedOn(id),
            assets: options.assets(id),
            ...(options.log ? { log: options.log } : {}),
            ...(options.availabilityChanged ? { availabilityChanged: options.availabilityChanged } : {}),
            ...(options.describeDelayMs !== undefined ? { describeDelayMs: options.describeDelayMs } : {}),
          },
          broadcast,
        ),
      ]),
    ) as Record<HostId, HostLink>;
  }

  get(id: HostId): HostLink {
    return this.links[id];
  }

  get all(): HostLink[] {
    return HOST_IDS.map((id) => this.links[id]);
  }

  /** The hosts that are connected and switched on: drawn, and offered to the agent. */
  get inUse(): HostLink[] {
    return this.all.filter((link) => link.inUse);
  }

  /** The hosts the agent can run code in now. */
  get runnable(): HostLink[] {
    return this.all.filter((link) => link.canRun);
  }

  /** Every mirrored object of every host in use, with its host. */
  get mirroredObjects(): MirroredObject[] {
    return this.inUse.flatMap((link) => link.mirroredObjects.map((o) => ({ ...o, host: link.id })));
  }

  /** The mirrored object with this id in any host in use, with its host. */
  object(id: string): MirroredObject | undefined {
    for (const link of this.inUse) {
      const object = link.object(id);
      if (object) return { ...object, host: link.id };
    }
    return undefined;
  }

  /** Sends a page what it needs to draw every host. */
  greet(send: Send): void {
    for (const link of this.all) link.greet(send);
  }

  /** The user changed Settings > Hosts. */
  switchesChanged(): void {
    for (const link of this.all) link.switchChanged();
  }

  /** Handles a message from a page: picks select in their host; edits, undo and redo go to their host. Returns false for others. */
  handleFromWeb(message: Message): boolean {
    switch (message.type) {
      case "host.select": {
        const { host, ids } = message.payload;
        for (const link of this.all) {
          if (link.id === host) link.select(ids);
          else if (ids.length > 0 && link.selection.length > 0) link.select([]);
          else if (ids.length === 0) link.select([]);
        }
        return true;
      }
      case "host.undo":
        this.links[message.payload.host].undoRun();
        return true;
      case "host.redo":
        this.links[message.payload.host].redo();
        return true;
      case "host.edit":
        this.links[message.payload.host].edit(message);
        return true;
      default:
        return false;
    }
  }
}
