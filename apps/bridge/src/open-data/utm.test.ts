import { describe, expect, it } from "vitest";
import { lonLatToUtm, utmEpsg, utmZone } from "./utm.ts";

describe("UTM", () => {
  it("finds the zone of a longitude, with the edges and the ends", () => {
    expect(utmZone(4.9)).toBe(31);
    expect(utmZone(6)).toBe(32);
    expect(utmZone(-0.1)).toBe(30);
    expect(utmZone(-180)).toBe(1);
    expect(utmZone(180)).toBe(60);
    expect(utmZone(-122.4)).toBe(10);
  });

  it("names the EPSG code of a zone by hemisphere", () => {
    expect(utmEpsg(31, 52.37)).toBe(32631);
    expect(utmEpsg(19, -34.6)).toBe(32719);
  });

  it("on the central meridian the easting is 500000 and the northing is the scaled meridian arc", () => {
    const at45 = lonLatToUtm(3, 45, 31);
    expect(at45.easting).toBeCloseTo(500_000, 3);
    // 0.9996 times the meridian arc from the equator to 45 degrees (4,984,944.4 m).
    expect(at45.northing).toBeCloseTo(4_982_950.4, 0);
    expect(lonLatToUtm(3, 0, 31)).toEqual({ easting: 500_000, northing: 0 });
  });

  it("is symmetric about the central meridian", () => {
    const west = lonLatToUtm(2, 52, 31);
    const east = lonLatToUtm(4, 52, 31);
    expect(west.northing).toBeCloseTo(east.northing, 4);
    expect(500_000 - west.easting).toBeCloseTo(east.easting - 500_000, 4);
  });

  it("a degree of longitude at the equator is about 111 km on the ground (scaled by 0.9996)", () => {
    const { easting } = lonLatToUtm(4, 0, 31);
    expect(easting - 500_000).toBeGreaterThan(111_200);
    expect(easting - 500_000).toBeLessThan(111_350);
  });

  it("counts the southern northing from 10,000,000 m", () => {
    const south = lonLatToUtm(3, -45, 31);
    expect(south.northing).toBeCloseTo(10_000_000 - 4_982_950.4, 0);
  });

  it("moves about 111 km north per degree of latitude, and about 1.1 km east per 0.01 degree at 52 N", () => {
    const a = lonLatToUtm(4.9, 52, 31);
    const b = lonLatToUtm(4.9, 53, 31);
    expect(b.northing - a.northing).toBeGreaterThan(111_000);
    expect(b.northing - a.northing).toBeLessThan(111_400);
    const c = lonLatToUtm(4.91, 52, 31);
    expect(c.easting - a.easting).toBeGreaterThan(680);
    expect(c.easting - a.easting).toBeLessThan(700);
  });
});
