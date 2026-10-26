import type { Message, OpenDataRecordEntry, Site } from "@hai/protocol";

/** What Settings > Open data shows: the choices the bridge keeps, the project's site and the requests made. */
export interface OpenDataState {
  /** Sources switched off or on by the user; a source not listed is on (subject to its limit). */
  sources: Record<string, boolean>;
  /** Sources whose limit the user acknowledged. */
  acknowledged: string[];
  /** Portal hosts the user added. */
  portalHosts: string[];
  /** Whether the city context agents fetched is drawn. */
  showContext: boolean;
  site: Site | null;
  /** The requests made in this session, oldest first. */
  record: OpenDataRecordEntry[];
}

const INITIAL: OpenDataState = {
  sources: {},
  acknowledged: [],
  portalHosts: [],
  showContext: true,
  site: null,
  record: [],
};

/**
 * The browser's side of open data: the source choices, the site and the record of requests, all kept by the bridge.
 * Edits are sent to the bridge and shown at once; the bridge's next message is the truth.
 */
export class OpenDataStore {
  private state = INITIAL;
  private readonly listeners = new Set<() => void>();

  /** `send` returns false when the bridge is offline. */
  constructor(private readonly send: (message: Message) => boolean) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): OpenDataState => this.state;

  /**
   * Handles a bridge message. A settings snapshot is read but not consumed (the app reads the rest of it), so this
   * returns false for it; the site and the record are this store's own.
   */
  handle(message: Message): boolean {
    switch (message.type) {
      case "settings.snapshot": {
        const { openDataSources, openDataAcknowledged, portalHosts, showContext } = message.payload;
        this.update({
          sources: openDataSources,
          acknowledged: openDataAcknowledged,
          portalHosts,
          showContext,
        });
        return false;
      }
      case "site.snapshot":
        this.update({ site: message.payload.site });
        return true;
      case "opendata.record":
        this.update({ record: message.payload.entries });
        return true;
      default:
        return false;
    }
  }

  setSource(id: string, on: boolean): void {
    this.update({ sources: { ...this.state.sources, [id]: on } });
    this.save({ openDataSources: { [id]: on } });
  }

  /** The user read a source's limit and accepts it. */
  acknowledge(id: string): void {
    this.update({ acknowledged: [...new Set([...this.state.acknowledged, id])] });
    this.save({ openDataAcknowledged: [id] });
  }

  setPortalHosts(hosts: string[]): void {
    this.update({ portalHosts: hosts });
    this.save({ portalHosts: hosts });
  }

  setShowContext(on: boolean): void {
    this.update({ showContext: on });
    this.save({ showContext: on });
  }

  /** Sets, changes or (with null) clears the project's site. */
  setSite(site: Site | null): void {
    this.update({ site });
    this.send({ type: "site.set", id: crypto.randomUUID(), payload: { site } });
  }

  clearRecord(): void {
    this.send({ type: "opendata.clear", id: crypto.randomUUID(), payload: {} });
  }

  private save(payload: Record<string, unknown>): void {
    this.send({ type: "settings.set", id: crypto.randomUUID(), payload } as Message);
  }

  private update(patch: Partial<OpenDataState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
