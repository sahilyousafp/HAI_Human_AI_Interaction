import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ContextItem, type Message, Site } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { adoptOp, ContextStore, contextFile, signedArea } from "./context-store.ts";

const site = Site.parse({ lat: 52.37, lon: 4.9 });
const other = Site.parse({ lat: 40, lon: -3 });
const building = (id: string, x: number, y: number, extra: Partial<ContextItem> = {}): ContextItem =>
  ({
    id,
    kind: "building",
    footprint: [
      [x, y],
      [x + 10_000, y],
      [x + 10_000, y + 8_000],
      [x, y + 8_000],
    ],
    heightMm: 12_000,
    heightSource: "measured",
    baseMm: 0,
    source: "overpass",
    ...extra,
  }) as ContextItem;
const tree = (id: string, x: number, y: number): ContextItem => ({
  id,
  kind: "tree",
  position: [x, y],
  source: "overpass",
});

function setup(current: { site: Site | null } = { site }) {
  const dir = mkdtempSync(join(tmpdir(), "hai-context-"));
  const sent: Message[] = [];
  const make = () =>
    new ContextStore(
      () => dir,
      () => current.site,
      (m) => sent.push(m),
    );
  return { dir, sent, current, store: make(), make };
}

describe("ContextStore", () => {
  it("starts empty and not stale", () => {
    const t = setup();
    expect(t.store.items).toEqual([]);
    expect(t.store.stale).toBe(false);
    expect(t.store.summary().counts).toEqual({ building: 0, tree: 0, raster: 0 });
  });

  it("holds the items, tells every client, and keeps them with the project (not in the scene)", () => {
    const t = setup();
    t.store.replace(
      "overpass",
      "building",
      [building("b1", 0, 0), building("b2", 50_000, 0)],
      site,
      "2026-10-01",
    );
    expect(t.sent.at(-1)).toMatchObject({ type: "context.snapshot", payload: { stale: false } });
    expect(JSON.parse(readFileSync(contextFile(t.dir), "utf8")).items).toHaveLength(2);
    expect(t.make().items).toHaveLength(2);
    expect(t.store.credits()).toEqual([
      {
        source: "OpenStreetMap (Overpass)",
        attribution: "Map data from OpenStreetMap contributors",
        date: "2026-10-01",
      },
    ]);
  });

  it("a repeated fetch of a source and kind replaces its items instead of doubling them, and keeps other kinds", () => {
    const t = setup();
    t.store.replace("overpass", "building", [building("b1", 0, 0)], site);
    t.store.replace("overpass", "tree", [tree("t1", 100, 100)], site);
    t.store.replace("overpass", "building", [building("b2", 0, 0), building("b3", 0, 0)], site);
    expect(t.store.items.map((i) => i.id).sort()).toEqual(["b2", "b3", "t1"]);
  });

  it("is marked stale when the site changed after it was built, and rebuilt for the new site starts clean", () => {
    const t = setup();
    t.store.replace("overpass", "building", [building("b1", 0, 0)], site);
    expect(t.store.stale).toBe(false);
    t.current.site = other;
    t.store.refresh();
    expect(t.store.stale).toBe(true);
    expect(t.sent.at(-1)).toMatchObject({ payload: { stale: true } });
    t.store.replace("overpass", "tree", [tree("t1", 0, 0)], other);
    expect(t.store.items.map((i) => i.id)).toEqual(["t1"]);
    expect(t.store.stale).toBe(false);
  });

  it("another project has its own layer, and clear empties it and its file", () => {
    const a = setup();
    a.store.replace("overpass", "building", [building("b1", 0, 0)], site);
    const dir2 = mkdtempSync(join(tmpdir(), "hai-context-"));
    let open = a.dir;
    const store = new ContextStore(
      () => open,
      () => site,
      () => {},
    );
    expect(store.items).toHaveLength(1);
    open = dir2;
    store.refresh();
    expect(store.items).toEqual([]);
    open = a.dir;
    store.refresh();
    store.clear();
    expect(store.items).toEqual([]);
    expect(
      new ContextStore(
        () => a.dir,
        () => site,
        () => {},
      ).items,
    ).toEqual([]);
  });

  it("a damaged file reads as an empty layer", () => {
    const t = setup();
    t.store.replace("overpass", "building", [building("b1", 0, 0)], site);
    writeFileSync(contextFile(t.dir), "{ no");
    expect(t.make().items).toEqual([]);
    writeFileSync(contextFile(t.dir), JSON.stringify({ builtFor: null, items: [{ kind: "building" }] }));
    expect(t.make().items).toEqual([]);
  });

  it("keeps the nearest items when a kind is over its limit, and says how many were dropped", () => {
    const t = setup();
    const many = Array.from({ length: 5010 }, (_, i) => tree(`t${i}`, i * 1000, 0));
    const result = t.store.replace("overpass", "tree", many, site);
    expect(result).toEqual({ kept: 5000, dropped: 10 });
    expect(t.store.items.some((i) => i.id === "t5009")).toBe(false);
    expect(t.store.items.some((i) => i.id === "t0")).toBe(true);
  });

  it("answers with the nearest items first and says when it cut the list short", () => {
    const t = setup();
    t.store.replace(
      "overpass",
      "building",
      [building("far", 90_000, 0), building("near", 1_000, 0), building("mid", 30_000, 0)],
      site,
    );
    const first = t.store.nearest([0, 0], { limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(["near", "mid"]);
    expect(first).toMatchObject({ total: 3, truncated: true });
    const all = t.store.nearest([0, 0], { limit: 10, radiusMm: 50_000 });
    expect(all.items.map((i) => i.id)).toEqual(["near", "mid"]);
    expect(all.truncated).toBe(false);
    expect(t.store.nearest([0, 0], { limit: 10, kinds: ["tree"] }).items).toEqual([]);
  });

  it("summarises the layer: counts, how many heights were measured, the credits and the stale flag", () => {
    const t = setup();
    t.store.replace(
      "overpass",
      "building",
      [
        building("b1", 0, 0),
        building("b2", 0, 0, { heightSource: "inferred" }),
        building("b3", 0, 0, { heightSource: "default" }),
      ],
      site,
    );
    const summary = t.store.summary();
    expect(summary.counts.building).toBe(3);
    expect(summary.buildingHeights).toEqual({ measured: 1, inferred: 1, default: 1 });
    expect(summary.stale).toBe(false);
    expect(summary.credits[0]?.source).toContain("OpenStreetMap");
  });
});

describe("adopting a building", () => {
  it("becomes a slab of the footprint whose thickness is the height, standing from the ground, tagged with its source", () => {
    const op = adoptOp(building("b1", 0, 0) as never, "ctx-b1", "OpenStreetMap contributors");
    expect(op).toMatchObject({
      op: "create",
      element: {
        id: "ctx-b1",
        type: "slab",
        base: 12_000,
        thickness: 12_000,
        tags: { "context.source": "OpenStreetMap contributors", "context.id": "b1" },
      },
    });
  });

  it("turns a clockwise footprint counter-clockwise, as the scene wants", () => {
    const cw = building("b1", 0, 0, {
      footprint: [
        [0, 0],
        [0, 8_000],
        [10_000, 8_000],
        [10_000, 0],
      ],
    } as never);
    const op = adoptOp(cw as never, "x", "s");
    if (op.op !== "create" || op.element.type !== "slab") throw new Error("not a slab");
    expect(signedArea(op.element.outline)).toBeGreaterThan(0);
  });

  it("stands on its own base", () => {
    const op = adoptOp(building("b1", 0, 0, { baseMm: 2_000 } as never) as never, "x", "s");
    if (op.op !== "create" || op.element.type !== "slab") throw new Error("not a slab");
    expect(op.element.base).toBe(14_000);
  });
});
