import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Site } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import {
  LANDSAT_NOW,
  LANDSAT_PLACE,
  type LandsatOptions,
  landsatItem,
  landsatTransport,
  PC_ASSET,
} from "../../test/landsat-fixture.ts";
import { OpenDataClient } from "./client.ts";
import { OpenDataRecord } from "./record.ts";
import { sourceHosts } from "./sources.ts";
import {
  fetchSurfaceTemperature,
  MAX_SURFACE_RADIUS_M,
  SURFACE_NOTE,
  temperatureStats,
  temperatureStops,
} from "./surface-temperature.ts";

const site = Site.parse(LANDSAT_PLACE);
const NOW = LANDSAT_NOW;
const item = landsatItem;

function setup(options: LandsatOptions = {}) {
  const calls: NonNullable<LandsatOptions["calls"]> = [];
  const dir = mkdtempSync(join(tmpdir(), "hai-surface-"));
  const transport = landsatTransport({ ...options, calls });
  const client = new OpenDataClient({
    allows: () => true,
    hosts: (id) => sourceHosts(id, []),
    cacheDir: () => dir,
    userAgent: "HAI/test",
    record: new OpenDataRecord(),
    transport,
    sleep: async () => {},
    gapMs: 0,
    now: () => NOW,
  });
  return { client, calls };
}

describe("surface temperature", () => {
  it("the newest low-cloud Landsat scene gives the minimum, mean and maximum ground temperature in degrees C", async () => {
    const t = setup({ qualifying: [item("LC09_new", "2026-10-18T10:40:00Z", 3.2)] });
    const result = await fetchSurfaceTemperature(t.client, site, 300, { now: NOW });
    expect(result.value.scene).toEqual({
      id: "LC09_new",
      date: "2026-10-18T10:40:00Z",
      platform: "landsat-9",
      cloudPercent: 3.2,
    });
    expect(result.value.minC).toBeCloseTo(24, 0);
    expect(result.value.maxC).toBeCloseTo(36, 0);
    expect(result.value.meanC).toBeGreaterThan(28);
    expect(result.value.meanC).toBeLessThan(32);
    expect(result.value.pixelM).toBe(30);
    expect(result.observedAt).toBe(Date.parse("2026-10-18T10:40:00Z"));
    expect(result.cached).toBe(false);
  });

  it("says it is the temperature of the surface and not of the air, and that a scene is a moment in the past", async () => {
    const t = setup({ qualifying: [item("LC09_new", "2026-10-18T10:40:00Z", 3.2)] });
    const { value } = await fetchSurfaceTemperature(t.client, site, 300, { now: NOW });
    expect(value.note).toBe(SURFACE_NOTE);
    expect(value.note).toMatch(/surface, not air temperature/);
    expect(value.note).toMatch(/moment in the past/);
  });

  it("gives the share of cells above a threshold when one is named", async () => {
    const t = setup({ qualifying: [item("LC09_new", "2026-10-18T10:40:00Z", 3.2)] });
    const { value } = await fetchSurfaceTemperature(t.client, site, 300, { now: NOW, thresholdC: 30 });
    expect(value.threshold?.c).toBe(30);
    expect(value.threshold?.shareAbove).toBeGreaterThan(0.4);
    expect(value.threshold?.shareAbove).toBeLessThan(0.6);
  });

  it("makes a ground overlay with a legend naming the quantity, the unit and the scene's date", async () => {
    const t = setup({ qualifying: [item("LC09_new", "2026-10-18T10:40:00Z", 3.2)] });
    const { overlay } = await fetchSurfaceTemperature(t.client, site, 300, { now: NOW });
    expect(overlay).toMatchObject({
      kind: "raster",
      id: "surface-temperature",
      quantity: "Surface temperature (not air)",
      unit: "degrees C",
      source: "planetary-computer",
      date: "2026-10-18T10:40:00Z",
      minMm: [-300_000, -300_000],
      maxMm: [300_000, 300_000],
    });
    expect(overlay.range[0]).toBeLessThanOrEqual(24);
    expect(overlay.range[1]).toBeGreaterThanOrEqual(36);
    expect(overlay.image.startsWith("data:image/png;base64,")).toBe(true);
    expect(overlay.legend.length).toBeGreaterThan(3);
  });

  it("signs the asset address through the service (no account) and reads only ranges of the signed file", async () => {
    const t = setup({ qualifying: [item("LC09_new", "2026-10-18T10:40:00Z", 3.2)] });
    await fetchSurfaceTemperature(t.client, site, 300, { now: NOW });
    const sign = t.calls.find((c) => c.url.includes("/sas/v1/sign"));
    expect(sign?.url).toContain(`href=${encodeURIComponent(PC_ASSET)}`);
    const reads = t.calls.filter((c) => c.url.startsWith("https://landsateuwest.blob.core.windows.net"));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((c) => c.url.includes("sig=TOKEN"))).toBe(true);
  });

  it("the search asks for Landsat 8 and 9, little cloud and the days named, and sends nothing of the project", async () => {
    const t = setup({ qualifying: [item("LC09_new", "2026-10-18T10:40:00Z", 3.2)] });
    await fetchSurfaceTemperature(t.client, site, 300, { now: NOW, maxAgeDays: 30, maxCloudPercent: 10 });
    const search = t.calls.find((c) => c.method === "POST");
    const sent = JSON.parse(search?.body ?? "{}");
    expect(sent.collections).toEqual(["landsat-c2-l2"]);
    expect(sent.query).toEqual({
      "eo:cloud_cover": { lt: 10 },
      platform: { in: ["landsat-8", "landsat-9"] },
    });
    expect(sent.datetime).toBe("2026-09-25T12:00:00.000Z/2026-10-25T12:00:00.000Z");
    expect(Object.keys(sent).sort()).toEqual(["bbox", "collections", "datetime", "limit", "query", "sortby"]);
  });

  it("with no suitable scene it says when the last scene was seen and gives no values", async () => {
    const t = setup({ qualifying: [], anyScene: [item("LC09_cloudy", "2026-10-02T10:40:00Z", 88)] });
    await expect(fetchSurfaceTemperature(t.client, site, 300, { now: NOW })).rejects.toThrow(
      /No Landsat scene with less than 20% cloud in the last 45 days.*last scene seen was 2026-10-02 with 88% cloud.*No values are given/,
    );
  });

  it("with no scene at all it says so", async () => {
    const t = setup();
    await expect(fetchSurfaceTemperature(t.client, site, 300, { now: NOW })).rejects.toThrow(
      /No scene at all was found/,
    );
  });

  it("tries the next scene when the signing fails for the first, and answers a repeat from the saved result", async () => {
    const t = setup({
      qualifying: [
        item("LC09_new", "2026-10-18T10:40:00Z", 3.2),
        item("LC08_old", "2026-10-02T10:40:00Z", 5),
      ],
    });
    await fetchSurfaceTemperature(t.client, site, 300, { now: NOW });
    const before = t.calls.length;
    const again = await fetchSurfaceTemperature(t.client, site, 300, { now: NOW });
    expect(again.cached).toBe(true);
    expect(t.calls.length).toBe(before);
  });

  it("refuses a radius past the limit, and a signing failure is reported", async () => {
    const t = setup({ qualifying: [item("LC09_new", "2026-10-18T10:40:00Z", 3.2)], signFails: true });
    await expect(
      fetchSurfaceTemperature(t.client, site, MAX_SURFACE_RADIUS_M + 1, { now: NOW }),
    ).rejects.toThrow(/limited to 1000 m/);
    await expect(fetchSurfaceTemperature(t.client, site, 300, { now: NOW })).rejects.toMatchObject({
      code: "http",
    });
  });
});

describe("temperature statistics and colours", () => {
  it("leave out cells with no value and count the share above a threshold", () => {
    const grid = { values: new Float32Array([20, 30, 40, Number.NaN]), size: 2, cellM: 30, pixelM: 30 };
    expect(temperatureStats(grid, 25)).toMatchObject({
      minC: 20,
      meanC: 30,
      maxC: 40,
      shareAbove: 0.667,
      valid: 3,
    });
    expect(temperatureStats(grid)?.shareAbove).toBeUndefined();
    expect(temperatureStats({ ...grid, values: new Float32Array([Number.NaN]) })).toBeNull();
  });

  it("the colour stops span the range from blue to red", () => {
    const stops = temperatureStops(20, 40);
    expect(stops[0]).toEqual({ value: 20, color: "#2b6cb0" });
    expect(stops.at(-1)).toEqual({ value: 40, color: "#c53030" });
    expect(stops.map((s) => s.value)).toEqual([...stops.map((s) => s.value)].sort((a, b) => a - b));
  });
});
