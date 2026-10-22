import { decodeMeshAsset, type MeshPart } from "@hai/scene";

export type AssetState =
  | { status: "loading" }
  | { status: "ready"; parts: MeshPart[] }
  | { status: "missing"; reason: string };

/** The bridge to fetch from, or null before it has been found. */
export type AssetSource = () => { port: number; token: string } | null;

export const assetUrl = (port: number, id: string): string => `http://127.0.0.1:${port}/assets/${id}`;

/**
 * The imported geometry the viewer draws, fetched from the bridge once per asset and kept (assets never change under
 * their id). An asset that cannot be had leaves its elements drawn as their bounding boxes; the bridge's project
 * status says which file is missing.
 */
export class ModelAssets {
  private readonly assets = new Map<string, AssetState>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private readonly source: AssetSource,
    private readonly fetchAsset: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes whenever an asset arrives or fails, so views know to redraw. */
  getVersion = (): number => this.version;

  /** The parts of an asset when it has arrived, else null. */
  parts(id: string): MeshPart[] | null {
    const state = this.assets.get(id);
    return state?.status === "ready" ? state.parts : null;
  }

  state(id: string): AssetState | undefined {
    return this.assets.get(id);
  }

  /** Starts fetching an asset the first time it is asked for. */
  ensure(id: string): void {
    if (this.assets.has(id)) return;
    const session = this.source();
    if (!session) return; // asked again once the bridge is known
    this.assets.set(id, { status: "loading" });
    void this.load(id, session);
  }

  /** The parts of an asset once it has been fetched, or null when it cannot be had. */
  whenLoaded(id: string): Promise<MeshPart[] | null> {
    this.ensure(id);
    return new Promise((resolve) => {
      const check = () => {
        const state = this.assets.get(id);
        if (!state || state.status === "loading") return false;
        resolve(state.status === "ready" ? state.parts : null);
        return true;
      };
      if (check()) return;
      const off = this.subscribe(() => {
        if (check()) off();
      });
    });
  }

  private async load(id: string, session: { port: number; token: string }): Promise<void> {
    try {
      const response = await this.fetchAsset(assetUrl(session.port, id), {
        headers: { authorization: `Bearer ${session.token}` },
      });
      if (!response.ok) {
        this.finish(id, { status: "missing", reason: `The bridge answered ${response.status}.` });
        return;
      }
      const decoded = decodeMeshAsset(new Uint8Array(await response.arrayBuffer()));
      this.finish(
        id,
        decoded.ok ? { status: "ready", parts: decoded.parts } : { status: "missing", reason: decoded.error },
      );
    } catch (error) {
      this.finish(id, { status: "missing", reason: (error as Error).message });
    }
  }

  private finish(id: string, state: AssetState): void {
    this.assets.set(id, state);
    this.version++;
    for (const listener of this.listeners) listener();
  }

  /** Forgets an asset that was missing, so it is fetched again (the project was reopened, say). */
  retryMissing(): void {
    for (const [id, state] of this.assets) if (state.status === "missing") this.assets.delete(id);
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
