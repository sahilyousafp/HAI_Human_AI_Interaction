import { Site } from "@hai/protocol";
import { geoToModel } from "@hai/scene";
import { describe, expect, it } from "vitest";
import { makeGeoTiff, serveRange } from "../../test/geotiff-fixture.ts";
import { OpenDataClient, type Transport } from "./client.ts";
import { openCog } from "./cog.ts";
import { crsFromEpsg, readSquare, toRasterXY } from "./raster-grid.ts";
import { OpenDataRecord } from "./record.ts";
import { lonLatToUtm } from "./utm.ts";

const site = Site.parse({ lat: 52.37, lon: 4.9 });

async function open(file: Buffer) {
  const transport: Transport = async (_url, init) => serveRange(file, init.headers.range);
  const client = new OpenDataClient({
    allows: () => true,
    hosts: () => ["data.example.org"],
    cacheDir: () => null,
    userAgent: "HAI/test",
    record: new OpenDataRecord(),
    transport,
    sleep: async () => {},
  });
  return openCog(client, "worldcover", "https://data.example.org/a.tif", "test");
}

/** A geographic raster over the site, 0.0002 degree (about 14 by 22 m) pixels, whose value says where it is: east of the site 10, west 20. */
function geographicRaster() {
  const pixel = 0.0002;
  const width = 100;
  const height = 100;
  const west = 4.9 - (width / 2) * pixel;
  const north = 52.37 + (height / 2) * pixel;
  const values = Array.from({ length: width * height }, (_, i) => (i % width < width / 2 ? 20 : 10));
  return makeGeoTiff({ width, height, west, north, pixel, values, epsg: 4326 });
}

const identity = (raw: number) => raw;

describe("coordinate systems", () => {
  it("knows geographic and UTM codes and refuses the rest", () => {
    expect(crsFromEpsg(4326)).toEqual({ kind: "geographic" });
    expect(crsFromEpsg(32631)).toEqual({ kind: "utm", zone: 31 });
    expect(crsFromEpsg(32719)).toEqual({ kind: "utm", zone: 19 });
    expect(() => crsFromEpsg(3857)).toThrow(/EPSG:3857/);
  });

  it("converts a place to the raster's coordinates", () => {
    expect(toRasterXY({ kind: "geographic" }, 4.9, 52.37)).toEqual([4.9, 52.37]);
    expect(toRasterXY({ kind: "utm", zone: 31 }, 4.9, 52.37)).toEqual([
      lonLatToUtm(4.9, 52.37, 31).easting,
      lonLatToUtm(4.9, 52.37, 31).northing,
    ]);
  });
});

describe("resampling a raster onto the model's grid", () => {
  it("a square around the site, north up: the western half has one value and the eastern the other", async () => {
    const tiff = await open(geographicRaster());
    const grid = await readSquare(tiff, { kind: "geographic" }, site, 100, 20, identity);
    expect(grid.size).toBe(20);
    expect(grid.cellM).toBe(10);
    const at = (row: number, col: number) => grid.values[row * 20 + col];
    expect(at(0, 2)).toBe(20); // top-left: north-west
    expect(at(19, 2)).toBe(20); // bottom-left: south-west
    expect(at(0, 17)).toBe(10); // top-right: north-east
    expect(at(10, 17)).toBe(10);
  });

  it("when true north is turned 90 degrees, the same raster lands turned the same way on the model", async () => {
    const tiff = await open(geographicRaster());
    // True north is 90 degrees counter-clockwise of +Y (it points to -X), so +Y points to true east.
    const turned = Site.parse({ lat: 52.37, lon: 4.9, northDeg: 90 });
    const grid = await readSquare(tiff, { kind: "geographic" }, turned, 100, 20, identity);
    // East is toward +Y (the top rows) and west toward -Y (the bottom rows).
    expect(grid.values[2 * 20 + 10]).toBe(10);
    expect(grid.values[17 * 20 + 10]).toBe(20);
  });

  it("a point put on the model by the site's own conversion carries the raster's value for that place", async () => {
    const tiff = await open(geographicRaster());
    const grid = await readSquare(tiff, { kind: "geographic" }, site, 100, 40, identity);
    const [x, y] = geoToModel(site, { lat: 52.3705, lon: 4.8995 }); // north-west of the site
    const col = Math.floor((x / 1000 + 100) / grid.cellM);
    const row = Math.floor((100 - y / 1000) / grid.cellM);
    expect(grid.values[row * 40 + col]).toBe(20);
  });

  it("a projected (UTM) raster is read the same way", async () => {
    const centre = lonLatToUtm(4.9, 52.37, 31);
    const pixel = 10;
    const size = 60;
    const values = Array.from({ length: size * size }, (_, i) => (i % size < size / 2 ? 5 : 7));
    const file = makeGeoTiff({
      width: size,
      height: size,
      west: centre.easting - (size / 2) * pixel,
      north: centre.northing + (size / 2) * pixel,
      pixel,
      values,
      epsg: 32631,
      type: "u16",
    });
    const tiff = await open(file);
    const grid = await readSquare(tiff, { kind: "utm", zone: 31 }, site, 100, 10, identity);
    expect(grid.values[5 * 10 + 1]).toBe(5);
    expect(grid.values[5 * 10 + 8]).toBe(7);
    expect(grid.pixelM).toBe(10);
  });

  it("applies the conversion and marks no-data as NaN, and what the raster does not cover as NaN too", async () => {
    const file = makeGeoTiff({
      width: 20,
      height: 20,
      west: 4.9 - 0.002,
      north: 52.37 + 0.002,
      pixel: 0.0002,
      values: Array.from({ length: 400 }, (_, i) => (i % 20 === 0 ? 255 : 100)),
      epsg: 4326,
      noData: 255,
    });
    const tiff = await open(file);
    const grid = await readSquare(tiff, { kind: "geographic" }, site, 400, 16, (raw, noData) =>
      raw === noData ? Number.NaN : raw * 0.5,
    );
    // The raster covers only about 260 x 440 m of the 800 m square; the rest is NaN.
    expect(Number.isNaN(grid.values[0])).toBe(true);
    const inside = Array.from(grid.values).filter((v) => !Number.isNaN(v));
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.every((v) => v === 50)).toBe(true);
  });

  it("refuses a raster that does not cover the site at all", async () => {
    const tiff = await open(geographicRaster());
    const far = Site.parse({ lat: 10, lon: 10 });
    await expect(readSquare(tiff, { kind: "geographic" }, far, 100, 10, identity)).rejects.toThrow(
      /does not cover/,
    );
  });
});
