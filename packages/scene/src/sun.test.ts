import { describe, expect, it } from "vitest";
import { julianDay, sunLightDirection, sunPosition } from "./sun.ts";

const utc = (iso: string) => new Date(`${iso}Z`);

describe("sun position (NOAA algorithm)", () => {
  it("Julian day of the J2000 epoch", () => {
    expect(julianDay(utc("2000-01-01T12:00:00"))).toBe(2_451_545);
  });

  it("winter shadows: 21 December at noon in London, the sun is about 15 degrees up in the south", () => {
    const sun = sunPosition(utc("2026-12-21T12:00:00"), 51.5, 0);
    expect(sun.altitude).toBeCloseTo(15.2, 0);
    expect(sun.azimuth).toBeGreaterThan(178);
    expect(sun.azimuth).toBeLessThan(182);
    expect(sun.declination).toBeCloseTo(-23.44, 1);
  });

  it("midsummer noon in London: about 62 degrees", () => {
    const sun = sunPosition(utc("2026-06-21T12:00:00"), 51.5, 0);
    expect(sun.altitude).toBeCloseTo(62, 0);
    expect(sun.declination).toBeCloseTo(23.44, 1);
  });

  it("the equation of time has its known extremes: about -14.2 min in mid-February, +16.4 min in early November", () => {
    expect(sunPosition(utc("2026-02-11T12:00:00"), 0, 0).equationOfTime).toBeCloseTo(-14.2, 0);
    expect(sunPosition(utc("2026-11-03T12:00:00"), 0, 0).equationOfTime).toBeCloseTo(16.4, 0);
  });

  it("the sun rises in the east and sets in the west at the equinox", () => {
    const morning = sunPosition(utc("2026-03-20T07:00:00"), 51.5, 0);
    const evening = sunPosition(utc("2026-03-20T17:00:00"), 51.5, 0);
    expect(morning.azimuth).toBeGreaterThan(90);
    expect(morning.azimuth).toBeLessThan(120);
    expect(evening.azimuth).toBeGreaterThan(240);
    expect(evening.azimuth).toBeLessThan(270);
    expect(sunPosition(utc("2026-03-20T00:00:00"), 51.5, 0).altitude).toBeLessThan(-30); // midnight
  });

  it("longitude shifts solar noon by four minutes per degree", () => {
    // In New York (74 W) the sun is highest about 4.9 h after it is in London.
    const highest = (lon: number) => {
      let best = { minute: 0, altitude: -90 };
      for (let minute = 0; minute < 1440; minute += 2) {
        const { altitude } = sunPosition(new Date(Date.UTC(2026, 5, 21, 0, minute)), 40.7, lon);
        if (altitude > best.altitude) best = { minute, altitude };
      }
      return best.minute;
    };
    expect(highest(-74) - highest(0)).toBeGreaterThan(290);
    expect(highest(-74) - highest(0)).toBeLessThan(302);
  });

  it("in the southern hemisphere the noon sun is in the north", () => {
    const sun = sunPosition(utc("2026-06-21T02:00:00"), -33.9, 151.2); // Sydney, local noon
    expect(sun.azimuth > 350 || sun.azimuth < 10).toBe(true);
    expect(sun.altitude).toBeCloseTo(32.7, 0);
  });

  it("light from a sun in the south, 30 degrees up, travels north and down", () => {
    const [x, y, z] = sunLightDirection({ altitude: 30, azimuth: 180 });
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    expect(z).toBeCloseTo(-0.5, 6);
  });
});
