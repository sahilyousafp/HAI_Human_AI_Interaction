import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Site } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { makeGeoTiff, serveRange } from "../../test/geotiff-fixture.ts";
import { OpenDataClient, type RawResponse, type Transport } from "./client.ts";
import { OpenDataRecord } from "./record.ts";
import { sourceHosts } from "./sources.ts";
import { lonLatToUtm } from "./utm.ts";
import {
  fetchGreenness,
  fetchLandCover,
  greennessStats,
  landCoverShares,
  MAX_VEGETATION_RADIUS_M,
  ndvi,
  worldCoverTile,
} from "./vegetation.ts";

const site = Site.parse({ lat: 52.37, lon: 4.9 });
const NOW = Date.parse("2026-10-25T12:00:00Z");

/** A WorldCover-like tile around the site: the west half trees (10), the north-east built (50), the rest grass (30). */
const worldCover = (() => {
  const width = 400;
  const height = 400;
  const pixel = 0.0001;
  const values = Array.from({ length: width * height }, (_, i) => {
    const col = i % width;
    const row = Math.floor(i / width);
    return col < width / 2 ? 10 : row < height / 2 ? 50 : 30;
  });
  return makeGeoTiff({ width, height, west: 4.9 - 0.02, north: 52.37 + 0.02, pixel, values, epsg: 4326 });
})();

/** Sentinel-2 L2A-like bands around the site in UTM 31: red and near-infrared digital numbers, 10 m pixels. */
function band(red: boolean) {
  const centre = lonLatToUtm(4.9, 52.37, 31);
  const size = 300;
  const values = Array.from({ length: size * size }, (_, i) => {
    const green = i % size < size / 2; // the west half is green
    return red ? (green ? 2000 : 3000) : green ? 6000 : 3500;
  });
  return makeGeoTiff({
    width: size,
    height: size,
    west: centre.easting - (size / 2) * 10,
    north: centre.northing + (size / 2) * 10,
    pixel: 10,
    values,
    epsg: 32631,
    type: "u16",
  });
}
const RED = band(true);
const NIR = band(false);

const asset = (href: string) => ({ href, "raster:bands": [{ scale: 0.0001, offset: -0.1, nodata: 0 }] });
const item = (id: string, date: string, cloud: number, red: string, nir: string) => ({
  id,
  properties: { datetime: date, "eo:cloud_cover": cloud, "proj:epsg": 32631 },
  assets: { red: asset(red), nir: asset(nir) },
});
const COGS = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/s2";

function setup(options: { items?: unknown[]; cache?: boolean; tile?: Buffer } = {}) {
  const calls: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "hai-veg-"));
  const transport: Transport = async (url, init) => {
    calls.push(`${init.method} ${url.href}`);
    if (url.hostname === "earth-search.aws.element84.com")
      return {
        status: 200,
        headers: { "content-type": "application/geo+json" },
        body: Buffer.from(JSON.stringify({ features: options.items ?? [] })),
      } satisfies RawResponse;
    if (url.hostname.startsWith("esa-worldcover"))
      return serveRange(options.tile ?? worldCover, init.headers.range);
    if (url.pathname.endsWith("/missing.tif")) return { status: 404, headers: {}, body: Buffer.alloc(0) };
    if (url.pathname.endsWith("/red.tif")) return serveRange(RED, init.headers.range);
    if (url.pathname.endsWith("/nir.tif")) return serveRange(NIR, init.headers.range);
    return { status: 404, headers: {}, body: Buffer.alloc(0) };
  };
  const client = new OpenDataClient({
    allows: () => true,
    hosts: (id) => sourceHosts(id, []),
    cacheDir: () => (options.cache === false ? null : dir),
    userAgent: "HAI/test",
    record: new OpenDataRecord(),
    transport,
    sleep: async () => {},
    gapMs: 0,
    now: () => NOW,
  });
  return { client, calls };
}

describe("land cover", () => {
  it("names the 3 degree WorldCover tile of a place, in every quadrant", () => {
    expect(worldCoverTile(52.37, 4.9).name).toBe("ESA_WorldCover_10m_2021_v200_N51E003_Map.tif");
    expect(worldCoverTile(-33.9, 151.2).name).toBe("ESA_WorldCover_10m_2021_v200_S36E150_Map.tif");
    expect(worldCoverTile(40.7, -74).name).toBe("ESA_WorldCover_10m_2021_v200_N39W075_Map.tif");
    expect(worldCoverTile(52.37, 4.9).url).toBe(
      "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N51E003_Map.tif",
    );
  });

  it("shares are fractions of the cells with data, tree and grass together are the green share, no data is not counted", () => {
    const values = new Float32Array([10, 10, 30, 50, Number.NaN, 80, 95, 123]);
    const { shares, greenShare, coverage } = landCoverShares({ values, size: 4, cellM: 10, pixelM: 10 });
    expect(shares).toEqual({
      tree: 0.286,
      grass: 0.143,
      built: 0.143,
      water: 0.143,
      mangrove: 0.143,
      other: 0.143,
    });
    expect(greenShare).toBe(0.429);
    expect(coverage).toBe(0.875);
  });

  it("reads the window around the site from the tile and reports the shares and the map's year", async () => {
    const t = setup();
    const { value, cached } = await fetchLandCover(t.client, site, 200);
    expect(cached).toBe(false);
    expect(value.year).toBe(2021);
    expect(value.shares.tree).toBeGreaterThan(0.45);
    expect(value.shares.tree).toBeLessThan(0.55);
    expect(value.shares.built).toBeGreaterThan(0.2);
    expect(value.shares.grass).toBeGreaterThan(0.2);
    expect(value.greenShare).toBeCloseTo((value.shares.tree ?? 0) + (value.shares.grass ?? 0), 2);
    expect(value.coverage).toBeGreaterThan(0.95);
    expect(t.calls.every((c) => c.includes("esa-worldcover"))).toBe(true);
  });

  it("answers a repeat from the saved result and sends nothing", async () => {
    const t = setup();
    await fetchLandCover(t.client, site, 200);
    const before = t.calls.length;
    const again = await fetchLandCover(t.client, site, 200);
    expect(again.cached).toBe(true);
    expect(t.calls.length).toBe(before);
  });

  it("refuses a radius past the limit", async () => {
    const t = setup();
    await expect(fetchLandCover(t.client, site, MAX_VEGETATION_RADIUS_M + 1)).rejects.toThrow(
      /limited to 1000 m/,
    );
    expect(t.calls).toEqual([]);
  });

  it("a place the map has no data for (open water) says so instead of returning shares", async () => {
    const empty = makeGeoTiff({
      width: 400,
      height: 400,
      west: 4.9 - 0.02,
      north: 52.37 + 0.02,
      pixel: 0.0001,
      values: new Array(160_000).fill(0),
      epsg: 4326,
    });
    const t = setup({ tile: empty });
    await expect(fetchLandCover(t.client, site, 200)).rejects.toThrow(/no data for that place/);
  });
});

describe("NDVI", () => {
  it("is the normalised difference of near-infrared and red, clamped, and NaN where it cannot be worked out", () => {
    expect(ndvi(0.5, 0.1)).toBeCloseTo(0.667, 3);
    expect(ndvi(0.2, 0.2)).toBe(0);
    expect(ndvi(0.1, 0.5)).toBeCloseTo(-0.667, 3);
    expect(Number.isNaN(ndvi(Number.NaN, 0.1))).toBe(true);
    expect(Number.isNaN(ndvi(0, 0))).toBe(true);
  });

  it("the statistics of a grid leave out the cells without a value", () => {
    const stats = greennessStats({
      values: new Float32Array([0.8, 0.4, 0.1, Number.NaN]),
      size: 2,
      cellM: 10,
      pixelM: 10,
    });
    expect(stats).toMatchObject({ mean: 0.433, min: 0.1, max: 0.8, valid: 3 });
    expect(stats.greenCellShare).toBe(0.667);
  });
});

describe("greenness from Sentinel-2", () => {
  const scenes = [
    item("S2-new", "2026-10-20T10:30:00Z", 4.2, `${COGS}/new/red.tif`, `${COGS}/new/nir.tif`),
    item("S2-old", "2026-09-20T10:30:00Z", 9, `${COGS}/old/red.tif`, `${COGS}/old/nir.tif`),
  ];

  it("searches the newest scenes with little cloud around the site, and reads NDVI from the first that works", async () => {
    const t = setup({ items: scenes });
    const result = await fetchGreenness(t.client, site, 200, { now: NOW });
    const search = t.calls.find((c) => c.startsWith("POST"));
    expect(search).toContain("earth-search.aws.element84.com/v1/search");
    expect(result.value.scene).toEqual({ id: "S2-new", date: "2026-10-20T10:30:00Z", cloudPercent: 4.2 });
    // West half: red 0.1, nir 0.5 -> 0.667; east half: red 0.2, nir 0.25 -> 0.111.
    expect(result.value.mean).toBeGreaterThan(0.35);
    expect(result.value.mean).toBeLessThan(0.43);
    expect(result.value.max).toBeCloseTo(0.667, 2);
    expect(result.value.min).toBeCloseTo(0.111, 2);
    expect(result.value.greenCellShare).toBeGreaterThan(0.4);
    expect(result.value.greenCellShare).toBeLessThan(0.6);
    expect(result.observedAt).toBe(Date.parse("2026-10-20T10:30:00Z"));
  });

  it("makes a ground overlay for the layer: a picture over the square around the site, with a legend and the scene's date", async () => {
    const t = setup({ items: scenes });
    const { overlay } = await fetchGreenness(t.client, site, 200, { now: NOW });
    expect(overlay).toMatchObject({
      kind: "raster",
      id: "ndvi",
      source: "earth-search",
      date: "2026-10-20T10:30:00Z",
      minMm: [-200_000, -200_000],
      maxMm: [200_000, 200_000],
      range: [-0.1, 0.9],
    });
    expect(overlay?.image.startsWith("data:image/png;base64,")).toBe(true);
    expect(overlay?.legend.length).toBeGreaterThan(2);
    expect(
      (await fetchGreenness(setup({ items: scenes }).client, site, 200, { now: NOW, overlay: false }))
        .overlay,
    ).toBeNull();
  });

  it("tries the next scene when the newest cannot be read", async () => {
    const broken = [
      item("S2-bad", "2026-10-22T10:30:00Z", 3, `${COGS}/x/missing.tif`, `${COGS}/x/missing.tif`),
      ...scenes,
    ];
    const t = setup({ items: broken });
    const result = await fetchGreenness(t.client, site, 200, { now: NOW });
    expect(result.value.scene.id).toBe("S2-new");
  });

  it("says so when no scene with little cloud covers the place", async () => {
    const t = setup({ items: [] });
    await expect(fetchGreenness(t.client, site, 200, { now: NOW })).rejects.toThrow(
      /No Sentinel-2 scene with less than 15% cloud/,
    );
  });

  it("the search names a box around the site, a date range and the cloud limit, nothing of the project", async () => {
    let body = "";
    const base = setup({ items: scenes });
    const spy = new OpenDataClient({
      allows: () => true,
      hosts: (id) => sourceHosts(id, []),
      cacheDir: () => null,
      userAgent: "HAI/test",
      record: new OpenDataRecord(),
      transport: async (url, init) => {
        if (init.method === "POST") body = init.body ?? "";
        return (await (async () => {
          void base;
          return url.hostname.startsWith("earth-search")
            ? ({
                status: 200,
                headers: { "content-type": "application/geo+json" },
                body: Buffer.from(JSON.stringify({ features: scenes })),
              } as RawResponse)
            : serveRange(url.pathname.endsWith("red.tif") ? RED : NIR, init.headers.range);
        })()) as RawResponse;
      },
      sleep: async () => {},
      gapMs: 0,
    });
    await fetchGreenness(spy, site, 200, { now: NOW, maxCloudPercent: 10, maxAgeDays: 30 });
    const sent = JSON.parse(body);
    expect(sent.collections).toEqual(["sentinel-2-l2a"]);
    expect(sent.query).toEqual({ "eo:cloud_cover": { lt: 10 } });
    expect(sent.bbox[1]).toBeLessThan(52.37);
    expect(sent.bbox[3]).toBeGreaterThan(52.37);
    expect(sent.datetime).toMatch(/^2026-09-25T12:00:00.000Z\/2026-10-25T12:00:00.000Z$/);
    expect(Object.keys(sent).sort()).toEqual(["bbox", "collections", "datetime", "limit", "query", "sortby"]);
  });
});
