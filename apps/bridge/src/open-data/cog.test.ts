import { describe, expect, it } from "vitest";
import { makeGeoTiff, serveRange } from "../../test/geotiff-fixture.ts";
import { OpenDataClient, type Transport } from "./client.ts";
import { openCog, readWindow } from "./cog.ts";
import { OpenDataRecord } from "./record.ts";

/** A 40 x 30 byte raster over 5.0..5.04 E, 52.03..52.0 N (0.001 degree pixels), valued x + 100 y (mod 256). */
const width = 40;
const height = 30;
const values = Array.from(
  { length: width * height },
  (_, i) => ((i % width) + 100 * Math.floor(i / width)) % 256,
);
const file = makeGeoTiff({
  width,
  height,
  west: 5,
  north: 52.03,
  pixel: 0.001,
  values,
  epsg: 4326,
  noData: 255,
});

function setup() {
  const requests: Array<{ url: string; range?: string | undefined }> = [];
  const transport: Transport = async (url, init) => {
    requests.push({ url: url.href, range: init.headers.range });
    return serveRange(file, init.headers.range);
  };
  const client = new OpenDataClient({
    allows: () => true,
    hosts: () => ["data.example.org"],
    cacheDir: () => null,
    userAgent: "HAI/test",
    record: new OpenDataRecord(),
    transport,
    sleep: async () => {},
  });
  return { client, requests };
}

const URL_OF_FILE = "https://data.example.org/tiles/a.tif";

describe("reading a raster by ranges", () => {
  it("reads a window of the pixels and says which box it really covers", async () => {
    const t = setup();
    const tiff = await openCog(t.client, "worldcover", URL_OF_FILE, "land cover");
    const window = await readWindow(tiff, { minX: 5.01, maxX: 5.013, minY: 52.025, maxY: 52.028 });
    expect(window.width).toBe(3);
    expect(window.height).toBe(3);
    // Rows are numbered from the north edge (52.03): 52.028 is two pixels down.
    expect(Array.from(window.values)).toEqual(
      [
        (10 + 100 * 2) % 256,
        11 + 200,
        12 + 200,
        10 + 300,
        11 + 300,
        12 + 300,
        10 + 400,
        11 + 400,
        12 + 400,
      ].map((v) => v % 256),
    );
    expect(window.box.minX).toBeCloseTo(5.01, 9);
    expect(window.box.maxX).toBeCloseTo(5.013, 9);
    expect(window.box.maxY).toBeCloseTo(52.028, 9);
    expect(window.pixel[0]).toBeCloseTo(0.001, 9);
    expect(window.noData).toBe(255);
  });

  it("only ever asks for ranges, never the whole file, through the guarded client", async () => {
    const t = setup();
    const tiff = await openCog(t.client, "worldcover", URL_OF_FILE, "land cover");
    await readWindow(tiff, { minX: 5.0, maxX: 5.04, minY: 52.0, maxY: 52.03 });
    expect(t.requests.length).toBeGreaterThan(0);
    expect(t.requests.every((r) => r.range?.startsWith("bytes="))).toBe(true);
  });

  it("a box partly outside is cut to the raster, and one wholly outside is refused", async () => {
    const t = setup();
    const tiff = await openCog(t.client, "worldcover", URL_OF_FILE, "land cover");
    const partly = await readWindow(tiff, { minX: 4.99, maxX: 5.005, minY: 52.0, maxY: 52.04 });
    expect(partly.width).toBe(5);
    expect(partly.height).toBe(30);
    await expect(readWindow(tiff, { minX: 6, maxX: 6.1, minY: 53, maxY: 53.1 })).rejects.toThrow(
      /does not cover/,
    );
  });

  it("refuses an area that would be too many pixels", async () => {
    const t = setup();
    const tiff = await openCog(t.client, "worldcover", URL_OF_FILE, "land cover");
    await expect(
      readWindow(tiff, { minX: 5, maxX: 5.04, minY: 52, maxY: 52.03 }, 0, 100),
    ).rejects.toMatchObject({
      code: "too-large",
    });
  });

  it("reads a projected raster in its own units", async () => {
    const tiff32 = makeGeoTiff({
      width: 10,
      height: 10,
      west: 628_000,
      north: 5_804_000,
      pixel: 10,
      values: Array.from({ length: 100 }, (_, i) => i),
      epsg: 32631,
      type: "u16",
    });
    const transport: Transport = async (_url, init) => serveRange(tiff32, init.headers.range);
    const client = new OpenDataClient({
      allows: () => true,
      hosts: () => ["data.example.org"],
      cacheDir: () => null,
      userAgent: "HAI/test",
      record: new OpenDataRecord(),
      transport,
      sleep: async () => {},
    });
    const tiff = await openCog(client, "earth-search", URL_OF_FILE, "greenness");
    const window = await readWindow(tiff, { minX: 628_020, maxX: 628_050, minY: 5_803_950, maxY: 5_803_980 });
    expect(window.width).toBe(3);
    expect(Array.from(window.values)).toEqual([22, 23, 24, 32, 33, 34, 42, 43, 44]);
  });
});
