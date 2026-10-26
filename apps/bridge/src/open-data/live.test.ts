import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Site } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { OpenDataClient } from "./client.ts";
import { fetchBuildings } from "./overpass.ts";
import { readDataset, searchPortal } from "./portals.ts";
import { OpenDataRecord } from "./record.ts";
import { openDataUserAgent, sourceHosts } from "./sources.ts";
import { fetchSurfaceTemperature } from "./surface-temperature.ts";
import { fetchGreenness, fetchLandCover } from "./vegetation.ts";
import { climateNormals, weatherForecast, weatherNow } from "./weather.ts";

// The real sources, once, by hand: HAI_LIVE_OPEN_DATA=1 pnpm --filter @hai/bridge exec vitest run src/open-data/live.test.ts
// Each adapter's real answer must have the shape its fixture has. Open-Meteo is left out on purpose: its free service
// is for non-commercial use and stays off until a user acknowledges it. Requests are few and spaced by the client.

const LIVE = process.env.HAI_LIVE_OPEN_DATA === "1";
const AMSTERDAM = Site.parse({ lat: 52.3731, lon: 4.8922 });
const NEW_YORK = { lat: 40.7128, lon: -74.006 };

function liveClient() {
  const record = new OpenDataRecord();
  const client = new OpenDataClient({
    allows: () => true,
    hosts: (id) =>
      sourceHosts(id, ["data.cityofnewyork.us", "ckan.publishing.service.gov.uk", "hub.arcgis.com"]),
    cacheDir: () => mkdtempSync(join(tmpdir(), "hai-live-open-data-")),
    userAgent: openDataUserAgent("live-check"),
    record,
  });
  return { client, record };
}

const report: string[] = [];
const note = (line: string) => {
  report.push(line);
  console.log(`[live] ${line}`);
};

describe.skipIf(!LIVE)("real open-data sources", () => {
  const { client, record } = liveClient();
  const minutes = (ms: number | null) =>
    ms === null ? "n/a" : `${Math.round((Date.now() - ms) / 60_000)} min old`;

  it("MET Norway: weather now and the forecast", { timeout: 60_000 }, async () => {
    const now = await weatherNow(client, AMSTERDAM, ["met-norway"]);
    note(`met-norway now: ${JSON.stringify(now.value)} (${minutes(now.observedAt)})`);
    expect(now.sourceId).toBe("met-norway");
    expect(typeof now.value.airTemperatureC).toBe("number");
    const forecast = await weatherForecast(client, AMSTERDAM, ["met-norway"], 6);
    note(`met-norway forecast: ${forecast.value.length} hours`);
    expect(forecast.value.length).toBeGreaterThan(0);
  });

  it("US National Weather Service: weather now in New York", { timeout: 60_000 }, async () => {
    const now = await weatherNow(client, NEW_YORK, ["nws"]);
    note(`nws now: ${JSON.stringify(now.value)} (${minutes(now.observedAt)})`);
    expect(now.sourceId).toBe("nws");
    expect(typeof now.value.airTemperatureC).toBe("number");
  });

  it("NASA POWER: climate normals", { timeout: 90_000 }, async () => {
    const normals = await climateNormals(client, AMSTERDAM);
    note(
      `nasa-power normals: period ${normals.value.period}, annual ${JSON.stringify(normals.value.annual)}`,
    );
    expect(normals.value.months).toHaveLength(12);
    expect(normals.value.annual.airTemperatureC).not.toBeNull();
  });

  it("OpenStreetMap Overpass: buildings and trees with heights", { timeout: 120_000 }, async () => {
    const result = await fetchBuildings(client, AMSTERDAM, 300, true);
    const measured = result.buildings.filter((b) => b.heightSource === "measured").length;
    note(
      `overpass: ${result.buildings.length} buildings (${measured} with a measured height), ${result.trees.length} trees`,
    );
    expect(result.buildings.length).toBeGreaterThan(10);
    expect(result.buildings[0]?.footprint.length).toBeGreaterThanOrEqual(3);
  });

  it("ESA WorldCover: land cover shares", { timeout: 120_000 }, async () => {
    const cover = await fetchLandCover(client, AMSTERDAM, 300);
    note(`worldcover: ${JSON.stringify(cover.value)}`);
    expect(cover.value).toBeDefined();
  });

  it("Sentinel-2 (Earth Search): greenness", { timeout: 180_000 }, async () => {
    const green = await fetchGreenness(client, AMSTERDAM, 300, { maxCloudPercent: 60, maxAgeDays: 90 });
    note(`sentinel-2 ndvi: ${JSON.stringify(green.value)} (scene ${minutes(green.observedAt)})`);
    expect(green.value).toBeDefined();
  });

  it("Landsat (Planetary Computer): surface temperature", { timeout: 180_000 }, async () => {
    const t = await fetchSurfaceTemperature(client, AMSTERDAM, 300, { maxAgeDays: 90, maxCloudPercent: 60 });
    note(`landsat: ${JSON.stringify({ ...t.value, note: undefined })} (scene ${minutes(t.observedAt)})`);
    expect(t.value.minC).toBeLessThan(t.value.maxC);
    expect(t.value.maxC).toBeLessThan(80);
    expect(t.value.minC).toBeGreaterThan(-40);
  });

  it("portals: a CKAN search and table, and a Socrata search", { timeout: 120_000 }, async () => {
    const ckan = await searchPortal(client, "ckan.publishing.service.gov.uk", "ckan", "street trees", 3);
    note(
      `ckan.publishing.service.gov.uk: ${ckan.datasets.length} datasets, first "${ckan.datasets[0]?.title}"`,
    );
    expect(ckan.datasets.length).toBeGreaterThan(0);
    const socrata = await searchPortal(client, "data.cityofnewyork.us", "socrata", "street trees", 3);
    note(`data.cityofnewyork.us: ${socrata.datasets.length} datasets, first "${socrata.datasets[0]?.title}"`);
    expect(socrata.datasets.length).toBeGreaterThan(0);
    const first = socrata.datasets[0];
    if (first) {
      const table = await readDataset(client, "data.cityofnewyork.us", "socrata", first.id, undefined, 3);
      note(
        `socrata table: ${table.table.rows.length} rows, columns ${table.table.columns.slice(0, 5).join(", ")}`,
      );
    }
  });

  it("the record names every host that was contacted, and only those allowed", () => {
    const hosts = [...new Set([...record.entries].map((e) => e.host))].sort();
    note(`hosts contacted: ${hosts.join(", ")}`);
    expect(hosts).not.toContain("api.open-meteo.com");
    expect(hosts.length).toBeGreaterThan(3);
  });
});
