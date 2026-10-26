import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CONTEXT_MAX_BUILDINGS,
  CONTEXT_MAX_RASTERS,
  CONTEXT_MAX_TREES,
  type ContextBuilding,
  type ContextCredit,
  ContextItem,
  type Message,
  OPEN_DATA_SOURCES,
  type SceneOp,
  Site,
} from "@hai/protocol";
import { z } from "zod";

type Send = (message: Message) => void;

/** Where the open project keeps its context layer: inside the project, beside the site. */
export const contextFile = (projectDir: string) => join(projectDir, ".hai", "context.json");

const Saved = z.strictObject({
  builtFor: Site.nullable(),
  items: z.array(ContextItem),
  /** When each source's data was fetched or observed, for the credits. */
  dates: z.record(z.string(), z.string().nullable()).default({}),
  /** Which "source:kind" sets were fetched, so a metric can tell "none there" from "never asked". */
  fetched: z.array(z.string()).default([]),
});
type Saved = z.infer<typeof Saved>;

const same = (a: Site | null, b: Site | null) => JSON.stringify(a) === JSON.stringify(b);

/** A point to measure from, in model millimetres. */
export type Near = readonly [number, number];

/** The reference point of an item (a building's centre of its footprint, a raster's centre). */
export function itemPoint(item: ContextItem): [number, number] {
  switch (item.kind) {
    case "tree":
      return [item.position[0], item.position[1]];
    case "raster":
      return [(item.minMm[0] + item.maxMm[0]) / 2, (item.minMm[1] + item.maxMm[1]) / 2];
    case "building": {
      let x = 0;
      let y = 0;
      for (const [px, py] of item.footprint) {
        x += px;
        y += py;
      }
      return [x / item.footprint.length, y / item.footprint.length];
    }
  }
}

/**
 * The city context agents fetched: buildings, trees and ground data around the site. It is not part of the scene
 * document (no undo, no claims, never saved with the model); it is kept in the project's `.hai/context.json`, read
 * again when another project opens, and sent to every client whenever it changes. A layer built for an older site is
 * marked stale until it is fetched again.
 */
export class ContextStore {
  private loaded: { dir: string | null; saved: Saved } | null = null;

  constructor(
    private readonly projectDir: () => string | null,
    private readonly site: () => Site | null,
    private readonly broadcast: Send,
  ) {}

  private get saved(): Saved {
    const dir = this.projectDir();
    if (!this.loaded || this.loaded.dir !== dir) this.loaded = { dir, saved: this.read(dir) };
    return this.loaded.saved;
  }

  get items(): readonly ContextItem[] {
    return this.saved.items;
  }

  /** Whether this source's kind of items was fetched for the layer's site (even if it found none). */
  wasFetched(sourceId: string, kind: ContextItem["kind"]): boolean {
    return this.saved.fetched.includes(`${sourceId}:${kind}`);
  }

  /** The layer was built for another site than the project has now. */
  get stale(): boolean {
    return this.saved.items.length > 0 && !same(this.saved.builtFor, this.site());
  }

  /** What the layer holds, for an agent: counts by kind, the sources and dates, and whether it is out of date. */
  summary() {
    const counts = { building: 0, tree: 0, raster: 0 };
    for (const item of this.saved.items) counts[item.kind] += 1;
    const heights = this.saved.items.flatMap((i) => (i.kind === "building" ? [i.heightSource] : []));
    return {
      counts,
      ...(counts.building > 0
        ? {
            buildingHeights: {
              measured: heights.filter((h) => h === "measured").length,
              inferred: heights.filter((h) => h === "inferred").length,
              default: heights.filter((h) => h === "default").length,
            },
          }
        : {}),
      rasters: this.saved.items.flatMap((i) =>
        i.kind === "raster"
          ? [
              {
                id: i.id,
                label: i.label,
                quantity: i.quantity,
                unit: i.unit,
                source: i.source,
                date: i.date,
                range: i.range,
              },
            ]
          : [],
      ),
      credits: this.credits(),
      stale: this.stale,
      builtFor: this.saved.builtFor,
    };
  }

  /**
   * Replaces everything of one source and one kind with new items (a repeated fetch updates, never doubles), for the
   * site they were built for. Items past the layer's limits are dropped, farthest from the site first, and the count
   * dropped is returned.
   */
  replace(
    sourceId: string,
    kind: ContextItem["kind"],
    items: ContextItem[],
    site: Site | null,
    date: string | null = null,
  ): { kept: number; dropped: number } {
    const limit = { building: CONTEXT_MAX_BUILDINGS, tree: CONTEXT_MAX_TREES, raster: CONTEXT_MAX_RASTERS }[
      kind
    ];
    const here = site
      ? ([site.anchorMm[0], site.anchorMm[1]] as [number, number])
      : ([0, 0] as [number, number]);
    const nearest = [...items].sort((a, b) => dist(itemPoint(a), here) - dist(itemPoint(b), here));
    const kept = nearest.slice(0, limit);
    // A layer built for another site does not mix with this one's items.
    const keep = this.saved.items.filter(
      (i) => !(i.kind === kind && i.source === sourceId) && same(this.saved.builtFor, site),
    );
    const sameSite = same(this.saved.builtFor, site);
    this.commit({
      builtFor: site,
      fetched: [...new Set([...(sameSite ? this.saved.fetched : []), `${sourceId}:${kind}`])],
      items: [...keep, ...kept],
      dates: {
        ...(same(this.saved.builtFor, site) ? this.saved.dates : {}),
        [sourceId]: date ?? (same(this.saved.builtFor, site) ? (this.saved.dates[sourceId] ?? null) : null),
      },
    });
    return { kept: kept.length, dropped: nearest.length - kept.length };
  }

  clear(): void {
    this.commit({ builtFor: this.saved.builtFor, items: [], dates: {}, fetched: [] });
  }

  /** The site changed (or another project opened): the stale flag may have changed, tell every client. */
  refresh(): void {
    this.loaded = null;
    this.broadcast(this.snapshot());
  }

  /**
   * The items near a point, nearest first, at most `limit`. `truncated` says some were left out. Positions are model
   * millimetres.
   */
  nearest(
    near: Near,
    options: { kinds?: ReadonlyArray<ContextItem["kind"]>; radiusMm?: number; limit: number },
  ): { items: ContextItem[]; total: number; truncated: boolean } {
    const kinds = options.kinds ?? ["building", "tree", "raster"];
    const within = this.saved.items
      .filter((i) => kinds.includes(i.kind))
      .map((item) => ({ item, d: dist(itemPoint(item), near) }))
      .filter(({ d }) => options.radiusMm === undefined || d <= options.radiusMm)
      .sort((a, b) => a.d - b.d);
    return {
      items: within.slice(0, options.limit).map(({ item }) => item),
      total: within.length,
      truncated: within.length > options.limit,
    };
  }

  byId(id: string): ContextItem | undefined {
    return this.saved.items.find((i) => i.id === id);
  }

  greet(send: Send): void {
    send(this.snapshot());
  }

  credits(): ContextCredit[] {
    const used = new Set(this.saved.items.map((i) => i.source));
    return OPEN_DATA_SOURCES.filter((s) => used.has(s.id)).map((s) => ({
      source: s.name,
      attribution: s.attribution,
      date: this.saved.dates[s.id] ?? null,
    }));
  }

  private snapshot(): Message {
    return {
      type: "context.snapshot",
      id: randomUUID(),
      payload: { items: [...this.saved.items], stale: this.stale, credits: this.credits() },
    };
  }

  private commit(next: Saved): void {
    const dir = this.projectDir();
    this.loaded = { dir, saved: next };
    if (dir) {
      const file = contextFile(dir);
      if (next.items.length === 0) rmSync(file, { force: true });
      else {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(next));
      }
    }
    this.broadcast(this.snapshot());
  }

  private read(dir: string | null): Saved {
    const empty: Saved = { builtFor: null, items: [], dates: {}, fetched: [] };
    if (!dir) return empty;
    try {
      const parsed = Saved.safeParse(JSON.parse(readFileSync(contextFile(dir), "utf8")));
      return parsed.success ? parsed.data : empty;
    } catch {
      return empty;
    }
  }
}

const dist = (a: Near, b: Near) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The signed area of a polygon (positive when counter-clockwise), mm squared. */
export function signedArea(points: ReadonlyArray<readonly [number, number]>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i] as readonly [number, number];
    const [x1, y1] = points[(i + 1) % points.length] as readonly [number, number];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

/**
 * The element a building becomes when a writer adopts it: its footprint extruded to its height (a slab whose thickness
 * is the height, counter-clockwise as the scene wants), tagged with where it came from so it is not taken for the
 * agent's own design.
 */
export function adoptOp(building: ContextBuilding, id: string, sourceName: string): SceneOp {
  const outline =
    signedArea(building.footprint) >= 0 ? building.footprint : [...building.footprint].reverse();
  return {
    op: "create",
    element: {
      id,
      type: "slab",
      name: building.label ?? `Neighbour ${building.id}`,
      base: building.baseMm + building.heightMm,
      outline: outline.map(([x, y]) => [x, y] as [number, number]),
      thickness: building.heightMm,
      properties: { heightSource: building.heightSource },
      tags: { "context.source": sourceName, "context.id": building.id },
    },
  };
}
