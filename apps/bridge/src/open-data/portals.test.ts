import { describe, expect, it } from "vitest";
import { OpenDataClient, type RawResponse, type Transport } from "./client.ts";
import { detectKind, readDataset, searchPortal, searchUrl, starterKind, TABLE_ROW_LIMIT } from "./portals.ts";
import { OpenDataRecord } from "./record.ts";

const json = (value: unknown, status = 200): RawResponse => ({
  status,
  headers: { "content-type": "application/json" },
  body: Buffer.from(JSON.stringify(value)),
});

function setup(
  respond: (url: URL) => RawResponse,
  hosts = ["data.example.org", "ckan.publishing.service.gov.uk"],
) {
  const calls: string[] = [];
  const transport: Transport = async (url) => {
    calls.push(url.href);
    return respond(url);
  };
  const client = new OpenDataClient({
    allows: () => true,
    hosts: () => hosts,
    cacheDir: () => null,
    userAgent: "HAI/test",
    record: new OpenDataRecord(),
    transport,
    sleep: async () => {},
    gapMs: 0,
  });
  return { client, calls };
}

const ckanPackage = {
  id: "11111111-aaaa",
  name: "street-trees",
  title: "Street trees",
  notes: "Every tree on a street, with species and trunk size.",
  metadata_modified: "2026-09-01T10:00:00",
  license_title: "Creative Commons Attribution",
  organization: { title: "City Parks" },
  resources: [
    { id: "r-1", format: "csv", datastore_active: true },
    { id: "r-2", format: "GeoJSON", datastore_active: false },
  ],
};

describe("portal search", () => {
  it("a CKAN catalogue answers with title, publisher, licence, date and formats, and which resources read as a table", async () => {
    const t = setup(() => json({ success: true, result: { count: 41, results: [ckanPackage] } }));
    const found = await searchPortal(t.client, "ckan.publishing.service.gov.uk", "ckan", "street trees", 5);
    expect(t.calls[0]).toBe(
      "https://ckan.publishing.service.gov.uk/api/3/action/package_search?q=street%20trees&rows=5",
    );
    expect(found.total).toBe(41);
    expect(found.datasets[0]).toMatchObject({
      id: "11111111-aaaa",
      title: "Street trees",
      publisher: "City Parks",
      licence: "Creative Commons Attribution",
      updated: "2026-09-01T10:00:00",
      formats: ["CSV", "GEOJSON"],
      url: "https://ckan.publishing.service.gov.uk/dataset/street-trees",
    });
    expect(found.datasets[0]?.resources).toEqual([
      { id: "r-1", format: "CSV", table: true },
      { id: "r-2", format: "GEOJSON", table: false },
    ]);
  });

  it("a Socrata catalogue answers from its own domain", async () => {
    const t = setup(() =>
      json({
        resultSetSize: 3,
        results: [
          {
            resource: {
              id: "abcd-1234",
              name: "Tree census",
              description: "A census.",
              updatedAt: "2026-08-01T00:00:00Z",
              attribution: "Parks Department",
            },
            metadata: { license: "Public Domain" },
            link: "https://data.example.org/d/abcd-1234",
          },
        ],
      }),
    );
    const found = await searchPortal(t.client, "data.example.org", "socrata", "trees", 5);
    expect(t.calls[0]).toBe("https://data.example.org/api/catalog/v1?q=trees&limit=5&only=datasets");
    expect(found.datasets[0]).toMatchObject({
      id: "abcd-1234",
      title: "Tree census",
      publisher: "Parks Department",
      licence: "Public Domain",
      updated: "2026-08-01T00:00:00Z",
    });
  });

  it("an ArcGIS Hub catalogue answers with its features' properties", async () => {
    const t = setup(() =>
      json({
        numberMatched: 9,
        features: [
          {
            id: "hub-1",
            properties: {
              title: "Tree canopy",
              owner: "Planning",
              modified: "2026-01-01",
              license: "CC0",
              url: "https://hub.example/x",
            },
          },
        ],
      }),
    );
    const found = await searchPortal(t.client, "data.example.org", "arcgis-hub", "canopy", 3);
    expect(found.datasets[0]).toMatchObject({
      id: "hub-1",
      title: "Tree canopy",
      publisher: "Planning",
      licence: "CC0",
    });
    expect(found.total).toBe(9);
  });

  it("knows the kind of a starter-list host and not of one the user added", () => {
    expect(starterKind("ckan.publishing.service.gov.uk")).toBe("ckan");
    expect(starterKind("data.cityofnewyork.us")).toBe("socrata");
    expect(starterKind("data.example.org")).toBeNull();
    expect(searchUrl("h.example", "ckan", "a b", 2)).toContain("q=a%20b&rows=2");
  });

  it("a host that is not listed is refused before anything is sent", async () => {
    const t = setup(() => json({}));
    await expect(searchPortal(t.client, "not-listed.example", "ckan", "x", 5)).rejects.toMatchObject({
      code: "host-not-allowed",
    });
    expect(t.calls).toEqual([]);
  });

  it("an answer that is not JSON is reported", async () => {
    const t = setup(() => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<html>"),
    }));
    await expect(searchPortal(t.client, "data.example.org", "ckan", "x", 5)).rejects.toMatchObject({
      code: "content-type",
    });
  });
});

describe("reading a dataset", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ _id: i + 1, species: `tree ${i}`, trunk: 30 + i }));

  it("a table of 5000 rows is cut to the limit, with the columns, the total and a note that rows were left out", async () => {
    const t = setup(() =>
      json({
        success: true,
        result: {
          total: 5000,
          fields: [{ id: "_id" }, { id: "species" }, { id: "trunk" }],
          records: rows(TABLE_ROW_LIMIT + 1),
        },
      }),
    );
    const read = await readDataset(
      t.client,
      "ckan.publishing.service.gov.uk",
      "ckan",
      "street-trees",
      "r-1",
      5000,
    );
    expect(t.calls[0]).toBe(
      `https://ckan.publishing.service.gov.uk/api/3/action/datastore_search?resource_id=r-1&limit=${TABLE_ROW_LIMIT + 1}`,
    );
    expect(read.table.columns).toEqual(["species", "trunk"]);
    expect(read.table.rows).toHaveLength(TABLE_ROW_LIMIT);
    expect(read.table).toMatchObject({ total: 5000, truncated: true });
  });

  it("a short table is returned whole and not marked cut", async () => {
    const t = setup(() =>
      json({ success: true, result: { total: 3, fields: [{ id: "a" }], records: rows(3) } }),
    );
    const read = await readDataset(t.client, "ckan.publishing.service.gov.uk", "ckan", "d", undefined, 50);
    expect(read.table.rows).toHaveLength(3);
    expect(read.table.truncated).toBe(false);
  });

  it("a Socrata resource is read as JSON records with the limit passed on", async () => {
    const t = setup(() => json(rows(11)));
    const read = await readDataset(t.client, "data.example.org", "socrata", "abcd-1234", undefined, 10);
    expect(t.calls[0]).toBe("https://data.example.org/resource/abcd-1234.json?$limit=11");
    expect(read.table.rows).toHaveLength(10);
    expect(read.table.truncated).toBe(true);
    expect(read.table.columns).toEqual(["_id", "species", "trunk"]);
  });

  it("an ArcGIS Hub dataset says its features are on another host and how to reach them", async () => {
    const t = setup(() => json({}));
    await expect(
      readDataset(t.client, "data.example.org", "arcgis-hub", "hub-1", undefined, 10),
    ).rejects.toThrow(/Add that host/);
  });
});

describe("a portal the user added", () => {
  it("its kind is found by asking each platform in turn, the first that answers", async () => {
    const t = setup((url) =>
      url.pathname.startsWith("/api/3/action")
        ? json({}, 404)
        : url.pathname.startsWith("/api/catalog")
          ? json({ resultSetSize: 1, results: [] })
          : json({}, 404),
    );
    expect(await detectKind(t.client, "data.example.org")).toBe("socrata");
  });

  it("says so when no platform answers, and stops at once if Open data is off", async () => {
    const none = setup(() => json({}, 404));
    await expect(detectKind(none.client, "data.example.org")).rejects.toThrow(
      /did not answer as a CKAN, Socrata or ArcGIS Hub/,
    );
    const refused = setup(() => json({}), ["other.example"]);
    await expect(detectKind(refused.client, "data.example.org")).rejects.toMatchObject({
      code: "host-not-allowed",
    });
    expect(refused.calls).toEqual([]);
  });
});
