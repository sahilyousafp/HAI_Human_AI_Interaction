import { Site } from "@hai/protocol";
import { geoToModel } from "@hai/scene";
import { describe, expect, it } from "vitest";
import { OpenDataClient, type RawResponse, type Transport } from "./client.ts";
import {
  buildingHeight,
  DEFAULT_HEIGHT_MM,
  fetchBuildings,
  MAX_RADIUS_M,
  overpassQuery,
  parseHeightMm,
  parseOverpass,
} from "./overpass.ts";
import { OpenDataRecord } from "./record.ts";

const site = Site.parse({ lat: 52.37, lon: 4.9 });
/** A square of about `metres` on a side, `northM` and `eastM` metres from the site, as OSM geometry (closed). */
const square = (eastM: number, northM: number, metres = 10) => {
  const dLat = 1 / 111_250;
  const dLon = 1 / (111_412.84 * Math.cos((52.37 * Math.PI) / 180));
  const p = (e: number, n: number) => ({ lat: 52.37 + n * dLat, lon: 4.9 + e * dLon });
  return [
    p(eastM, northM),
    p(eastM + metres, northM),
    p(eastM + metres, northM + metres),
    p(eastM, northM + metres),
    p(eastM, northM),
  ];
};

const answer = {
  osm3s: { timestamp_osm_base: "2026-10-25T10:00:00Z" },
  elements: [
    {
      type: "way",
      id: 1,
      geometry: square(50, 20),
      tags: { building: "yes", height: "12.5", name: "Tower" },
    },
    { type: "way", id: 2, geometry: square(80, 20), tags: { building: "house", "building:levels": "4" } },
    { type: "way", id: 3, geometry: square(110, 20), tags: { building: "yes" } },
    { type: "way", id: 4, geometry: square(140, 20).slice(0, 2), tags: { building: "yes", height: "5" } },
    { type: "way", id: 5, geometry: square(0, 0), tags: { highway: "residential" } },
    { type: "node", id: 9, lat: 52.3702, lon: 4.9003, tags: { natural: "tree", height: "8" } },
    { type: "node", id: 10, lat: 52.3703, lon: 4.9004, tags: { natural: "tree" } },
    { type: "node", id: 11, lat: 52.3704, lon: 4.9005, tags: { amenity: "bench" } },
  ],
};

describe("height tags", () => {
  it.each([
    ["12", 12_000],
    ["12.5", 12_500],
    ["12,5", 12_500],
    ["12 m", 12_000],
    ["12m", 12_000],
    ["40 ft", 12_192],
    ["40'", 12_192],
  ])("%s is %i mm", (tag, mm) => {
    expect(parseHeightMm(tag)).toBe(mm);
  });

  it.each(["", "tall", "0", "-3", "12 storeys", "about 10 m", undefined])("%s is no height", (tag) => {
    expect(parseHeightMm(tag)).toBeNull();
  });

  it("a building has its height tag, else three metres a level (inferred), else a default (marked)", () => {
    expect(buildingHeight({ height: "20" })).toEqual({ heightMm: 20_000, heightSource: "measured" });
    expect(buildingHeight({ "building:levels": "5" })).toEqual({
      heightMm: 15_000,
      heightSource: "inferred",
    });
    expect(buildingHeight({ height: "tall", "building:levels": "2" })).toEqual({
      heightMm: 6_000,
      heightSource: "inferred",
    });
    expect(buildingHeight({})).toEqual({ heightMm: DEFAULT_HEIGHT_MM, heightSource: "default" });
    expect(buildingHeight({ "building:levels": "0" }).heightSource).toBe("default");
  });
});

describe("the query", () => {
  it("asks for buildings and, when wanted, trees inside the box", () => {
    const box = { south: 52.3, west: 4.8, north: 52.4, east: 5 };
    expect(overpassQuery(box, false)).toBe(
      '[out:json][timeout:45];(way["building"](52.300000,4.800000,52.400000,5.000000););out geom;',
    );
    expect(overpassQuery(box, true)).toContain(
      'node["natural"="tree"](52.300000,4.800000,52.400000,5.000000);',
    );
  });
});

describe("the answer", () => {
  const parsed = parseOverpass(answer, site);

  it("keeps buildings with a footprint, in model millimetres from the site, closed ring dropped", () => {
    expect(parsed.buildings.map((b) => b.id)).toEqual(["way/1", "way/2", "way/3"]);
    const tower = parsed.buildings[0];
    expect(tower?.footprint).toHaveLength(4);
    const [x, y] = (tower?.footprint ?? [])[0] as [number, number];
    expect(x).toBeGreaterThan(49_000);
    expect(x).toBeLessThan(51_000);
    expect(y).toBeGreaterThan(19_000);
    expect(y).toBeLessThan(21_000);
    expect(tower?.label).toBe("Tower");
  });

  it("marks where each height came from", () => {
    expect(parsed.buildings.map((b) => [b.heightMm, b.heightSource])).toEqual([
      [12_500, "measured"],
      [12_000, "inferred"],
      [DEFAULT_HEIGHT_MM, "default"],
    ]);
  });

  it("leaves out a way that is no building and a building of fewer than three points", () => {
    expect(parsed.buildings.some((b) => b.id === "way/4" || b.id === "way/5")).toBe(false);
  });

  it("keeps trees only, with a height when there is one", () => {
    expect(parsed.trees.map((t) => [t.id, t.heightMm])).toEqual([
      ["node/9", 8_000],
      ["node/10", undefined],
    ]);
    const [x] = (parsed.trees[0]?.position ?? []) as number[];
    expect(x).toBeCloseTo(geoToModel(site, { lat: 52.3702, lon: 4.9003 })[0], -1);
  });

  it("takes the observation time from the server's data timestamp", () => {
    expect(parsed.observedAt).toBe(Date.parse("2026-10-25T10:00:00Z"));
    expect(parseOverpass({ elements: [] }, site).observedAt).toBeNull();
  });

  it("reads nonsense as nothing", () => {
    expect(parseOverpass(null, site)).toMatchObject({ buildings: [], trees: [] });
    expect(parseOverpass({ elements: "no" }, site)).toMatchObject({ buildings: [] });
  });
});

describe("fetching", () => {
  function setup(respond: () => RawResponse) {
    const calls: Array<{ url: string; method: string; body?: string; headers: Record<string, string> }> = [];
    const transport: Transport = async (url, init) => {
      calls.push({
        url: url.href,
        method: init.method,
        headers: init.headers,
        ...(init.body ? { body: init.body } : {}),
      });
      return respond();
    };
    const client = new OpenDataClient({
      allows: () => true,
      hosts: () => ["overpass-api.de"],
      cacheDir: () => null,
      userAgent: "HAI/test",
      record: new OpenDataRecord(),
      transport,
      sleep: async () => {},
      gapMs: 0,
    });
    return { client, calls };
  }
  const ok = (): RawResponse => ({
    status: 200,
    headers: { "content-type": "application/json;charset=UTF-8" },
    body: Buffer.from(JSON.stringify(answer)),
  });

  it("posts the query to the public server and returns the items", async () => {
    const t = setup(ok);
    const result = await fetchBuildings(t.client, site, 300, true);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toMatchObject({ url: "https://overpass-api.de/api/interpreter", method: "POST" });
    expect(t.calls[0]?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(decodeURIComponent((t.calls[0]?.body ?? "").slice(5))).toContain('way["building"]');
    expect(result.buildings).toHaveLength(3);
    expect(result.trees).toHaveLength(2);
    expect(result.cached).toBe(false);
  });

  it("the request carries a place and a box, never anything of the project", async () => {
    const t = setup(ok);
    await fetchBuildings(t.client, site, 300, false);
    const body = decodeURIComponent((t.calls[0]?.body ?? "").slice(5));
    expect(body).toMatch(
      /^\[out:json\]\[timeout:45\];\(way\["building"\]\(52\.\d+,4\.\d+,52\.\d+,4\.\d+\);\);out geom;$/,
    );
  });

  it("refuses a radius past the limit without asking", async () => {
    const t = setup(ok);
    await expect(fetchBuildings(t.client, site, MAX_RADIUS_M + 1, true)).rejects.toThrow(/limited to 2000 m/);
    expect(t.calls).toEqual([]);
  });

  it("reports a busy server that answers with a page instead of JSON", async () => {
    const t = setup(() => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<html>busy"),
    }));
    await expect(fetchBuildings(t.client, site, 300, true)).rejects.toMatchObject({ code: "content-type" });
  });
});
