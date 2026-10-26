import { Site } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { geoToModel, modelToGeo, siteBox } from "./site.ts";

const amsterdam = Site.parse({ lat: 52.37, lon: 4.9 });
const metresNorth = (lat: number) => lat + 100 / 111_250; // about 100 m of latitude here

describe("the site's coordinates", () => {
  it("the anchor is at the anchor", () => {
    expect(geoToModel(amsterdam, { lat: 52.37, lon: 4.9 })).toEqual([0, 0]);
    expect(geoToModel({ ...amsterdam, anchorMm: [5000, -2000] }, { lat: 52.37, lon: 4.9 })).toEqual([
      5000, -2000,
    ]);
  });

  it("a point 100 m north is at y = 100000 mm and x = 0 when north is +Y", () => {
    const [x, y] = geoToModel(amsterdam, { lat: metresNorth(52.37), lon: 4.9 });
    expect(Math.abs(x)).toBeLessThan(1);
    expect(y).toBeGreaterThan(99_000);
    expect(y).toBeLessThan(101_000);
  });

  it("a point 100 m east is at x = 100000 mm", () => {
    const east = 4.9 + 100 / (111_412.84 * Math.cos((52.37 * Math.PI) / 180));
    const [x, y] = geoToModel(amsterdam, { lat: 52.37, lon: east });
    expect(x).toBeGreaterThan(99_000);
    expect(x).toBeLessThan(101_000);
    expect(Math.abs(y)).toBeLessThan(1);
  });

  it("with true north turned 90 degrees, a point 100 m north lies along the model's x axis", () => {
    const [x, y] = geoToModel({ ...amsterdam, northDeg: 90 }, { lat: metresNorth(52.37), lon: 4.9 });
    expect(Math.abs(y)).toBeLessThan(1);
    expect(Math.abs(x)).toBeGreaterThan(99_000);
    expect(Math.abs(x)).toBeLessThan(101_000);
  });

  it("converts back: a round trip returns the place to within a centimetre of arc", () => {
    for (const northDeg of [0, 33, -120]) {
      const site = { ...amsterdam, northDeg, anchorMm: [1200, -800] as [number, number] };
      const point = { lat: 52.3731, lon: 4.9042 };
      const back = modelToGeo(site, geoToModel(site, point));
      expect(back.lat).toBeCloseTo(point.lat, 8);
      expect(back.lon).toBeCloseTo(point.lon, 8);
    }
  });

  it("a box around the site covers the radius on every side", () => {
    const box = siteBox(amsterdam, 300);
    expect(box.north - box.south).toBeGreaterThan(0.005);
    expect(box.north - box.south).toBeLessThan(0.0056);
    expect(box.east - box.west).toBeGreaterThan(0.008);
    expect((box.north + box.south) / 2).toBeCloseTo(52.37, 8);
  });

  it("refuses an invalid latitude, longitude or north angle", () => {
    expect(Site.safeParse({ lat: 120, lon: 0 }).success).toBe(false);
    expect(Site.safeParse({ lat: 0, lon: 200 }).success).toBe(false);
    expect(Site.safeParse({ lat: 0, lon: 0, northDeg: 270 }).success).toBe(false);
    expect(Site.safeParse({ lat: 52.37, lon: 4.9 }).data).toEqual({
      lat: 52.37,
      lon: 4.9,
      northDeg: 0,
      anchorMm: [0, 0],
    });
  });
});
