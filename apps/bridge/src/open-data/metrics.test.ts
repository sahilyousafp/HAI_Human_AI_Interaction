import { type ContextItem, Site } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { clipToBox, urbanMetrics } from "./metrics.ts";

const site = Site.parse({ lat: 52.37, lon: 4.9 });
const building = (
  id: string,
  x: number,
  y: number,
  w: number,
  d: number,
  h: number,
  source: "measured" | "inferred" | "default" = "measured",
): ContextItem => ({
  id,
  kind: "building",
  footprint: [
    [x, y],
    [x + w, y],
    [x + w, y + d],
    [x, y + d],
  ],
  heightMm: h,
  heightSource: source,
  baseMm: 0,
  source: "overpass",
});
const tree = (id: string, x: number, y: number): ContextItem => ({
  id,
  kind: "tree",
  position: [x, y],
  source: "overpass",
});

const input = (items: ContextItem[], extra: Partial<Parameters<typeof urbanMetrics>[0]> = {}) => ({
  items,
  site,
  radiusM: 100,
  buildingsFetched: true,
  treesFetched: true,
  greenShare: { value: 0.3, basis: "ESA WorldCover 2021" },
  ...extra,
});

describe("clipping to the square", () => {
  const min = [0, 0] as const;
  const max = [100, 100] as const;
  const area = (p: ReadonlyArray<readonly [number, number]>) =>
    Math.abs(
      p.reduce(
        (s, [x0, y0], i) =>
          s +
          x0 * (p[(i + 1) % p.length] as readonly [number, number])[1] -
          (p[(i + 1) % p.length] as readonly [number, number])[0] * y0,
        0,
      ) / 2,
    );

  it("keeps a polygon inside, cuts one that crosses, and drops one that is outside", () => {
    const inside = [
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
    ] as const;
    expect(area(clipToBox(inside, min, max))).toBe(100);
    const crossing = [
      [90, 10],
      [130, 10],
      [130, 30],
      [90, 30],
    ] as const;
    expect(area(clipToBox(crossing, min, max))).toBe(200); // 10 wide by 20 tall inside
    const outside = [
      [200, 200],
      [210, 200],
      [210, 210],
      [200, 210],
    ] as const;
    expect(clipToBox(outside, min, max)).toEqual([]);
  });

  it("cuts a polygon that spans the whole square to the square", () => {
    const big = [
      [-50, -50],
      [150, -50],
      [150, 150],
      [-50, 150],
    ] as const;
    expect(area(clipToBox(big, min, max))).toBe(10_000);
  });
});

describe("urban metrics", () => {
  it("building coverage, weighted mean height, tallest and the share of measured heights, from the layer", () => {
    // Square 200 m x 200 m = 40000 m2. Two buildings: 20 x 20 m (400 m2) at 10 m, 40 x 10 m (400 m2) at 30 m.
    const items = [
      building("a", 0, 0, 20_000, 20_000, 10_000, "measured"),
      building("b", 50_000, 50_000, 40_000, 10_000, 30_000, "inferred"),
    ];
    const m = urbanMetrics(input(items));
    expect(m.areaM2).toBe(40_000);
    expect(m.buildings).toEqual({
      count: 2,
      coverageRatio: 0.02,
      meanHeightM: 20,
      maxHeightM: 30,
      heightsMeasuredShare: 0.5,
    });
  });

  it("counts only what stands in the square, and only the part of a building that is in it", () => {
    const items = [
      building("in", 0, 0, 10_000, 10_000, 10_000),
      building("out", 300_000, 0, 10_000, 10_000, 10_000),
      building("edge", 90_000, 0, 20_000, 10_000, 10_000), // half of it past the east edge of the 100 m radius
    ];
    const m = urbanMetrics(input(items));
    if ("missing" in m.buildings) throw new Error("missing");
    expect(m.buildings.count).toBe(2);
    expect(m.buildings.coverageRatio).toBeCloseTo((100 + 100) / 40_000, 4);
  });

  it("counts the trees in the square", () => {
    const m = urbanMetrics(
      input([tree("t1", 1_000, 1_000), tree("t2", -99_000, 99_000), tree("t3", 150_000, 0)]),
    );
    expect(m.trees).toEqual({ count: 2 });
  });

  it("carries the green share with its basis", () => {
    expect(urbanMetrics(input([])).greenShare).toEqual({ value: 0.3, basis: "ESA WorldCover 2021" });
  });

  it("a kind that was never fetched is missing, with how to fetch it, and is never a guess", () => {
    const m = urbanMetrics(input([], { buildingsFetched: false, treesFetched: false, greenShare: null }));
    expect(m.buildings).toMatchObject({ missing: expect.stringContaining("urban_buildings") });
    expect(m.trees).toMatchObject({ missing: expect.stringContaining("urban_buildings") });
    expect(m.greenShare).toMatchObject({
      missing: expect.stringContaining("urban_vegetation (radius_m 100)"),
    });
  });

  it("buildings fetched but none there is zero, not missing", () => {
    const m = urbanMetrics(input([]));
    expect(m.buildings).toEqual({
      count: 0,
      coverageRatio: 0,
      meanHeightM: 0,
      maxHeightM: 0,
      heightsMeasuredShare: 0,
    });
  });
});
