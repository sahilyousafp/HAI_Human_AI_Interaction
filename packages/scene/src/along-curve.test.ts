import type { Element, Point3Mm } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { arrayAlong, MAX_ARRAY, type RailStop, stopsAlong } from "./along-curve.ts";

const straight: Point3Mm[] = [
  [0, 0, 0],
  [3000, 0, 0],
];

const stopsOf = (points: Point3Mm[], options: Parameters<typeof stopsAlong>[1]): RailStop[] => {
  const result = stopsAlong(points, options);
  if (!result.ok) throw new Error(result.error);
  return result.stops;
};

describe("stopsAlong", () => {
  it("puts a copy every spacing, from the start, including the end when it fits", () => {
    const stops = stopsOf(straight, { spacing: 300 });
    expect(stops.map((s) => s.point[0])).toEqual([
      0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000,
    ]);
    expect(stops.at(0)?.t).toBe(0);
    expect(stops.at(-1)?.t).toBe(1);
  });

  it("leaves out a stop that would be past the end", () => {
    expect(stopsOf(straight, { spacing: 1000 }).map((s) => s.point[0])).toEqual([0, 1000, 2000, 3000]);
    expect(stopsOf(straight, { spacing: 1100 }).map((s) => s.point[0])).toEqual([0, 1100, 2200]);
  });

  it("spreads a count evenly from the start to the end", () => {
    expect(stopsOf(straight, { count: 4 }).map((s) => s.point[0])).toEqual([0, 1000, 2000, 3000]);
    expect(stopsOf(straight, { count: 1 }).map((s) => s.point[0])).toEqual([0]);
  });

  it("starts and stops where it is told, measured along the rail", () => {
    const stops = stopsOf(straight, { spacing: 500, from: 500, to: 2000 });
    expect(stops.map((s) => s.point[0])).toEqual([500, 1000, 1500, 2000]);
  });

  it("follows the corners and takes the way the rail runs on from one", () => {
    const bent: Point3Mm[] = [
      [0, 0, 0],
      [1000, 0, 0],
      [1000, 1000, 0],
    ];
    const stops = stopsOf(bent, { spacing: 500 });
    expect(stops.map((s) => [s.point[0], s.point[1]])).toEqual([
      [0, 0],
      [500, 0],
      [1000, 0],
      [1000, 500],
      [1000, 1000],
    ]);
    expect(stops.map((s) => s.headingDeg)).toEqual([0, 0, 90, 90, 90]);
  });

  it("measures along a rail that climbs by its real length", () => {
    const ramp: Point3Mm[] = [
      [0, 0, 0],
      [3000, 0, 4000],
    ];
    const stops = stopsOf(ramp, { spacing: 2500 });
    expect(stops.map((s) => s.point)).toEqual([
      [0, 0, 0],
      [1500, 0, 2000],
      [3000, 0, 4000],
    ]);
  });

  it("does not repeat the start at the end of a closed rail", () => {
    const square: Point3Mm[] = [
      [0, 0, 0],
      [1000, 0, 0],
      [1000, 1000, 0],
      [0, 1000, 0],
    ];
    expect(stopsOf(square, { closed: true, spacing: 1000 })).toHaveLength(4);
    expect(stopsOf(square, { closed: true, count: 8 })).toHaveLength(8);
    expect(stopsOf(square, { closed: true, count: 8 }).at(-1)?.point).toEqual([0, 500, 0]);
  });

  it("refuses what it cannot do, saying why", () => {
    expect(stopsAlong(straight, {})).toMatchObject({ ok: false, error: "Give either spacing or count." });
    expect(stopsAlong(straight, { spacing: 100, count: 3 })).toMatchObject({ ok: false });
    expect(stopsAlong(straight, { spacing: 0 })).toMatchObject({ ok: false });
    expect(stopsAlong(straight, { count: 2.5 })).toMatchObject({ ok: false });
    expect(stopsAlong(straight, { spacing: 100, to: 9000 })).toMatchObject({ ok: false });
    expect(
      stopsAlong(
        [
          [5, 5, 0],
          [5, 5, 0],
        ],
        { spacing: 1 },
      ),
    ).toMatchObject({ ok: false, error: "The rail has no length." });
    const many = stopsAlong(straight, { spacing: 1 });
    expect(many).toMatchObject({ ok: false });
    expect(many.ok ? "" : many.error).toContain(`at most ${MAX_ARRAY}`);
  });
});

const column: Element = {
  id: "c1",
  name: "Post",
  type: "column",
  position: [100, 100],
  section: [200, 150],
  height: 2400,
  properties: {},
};

const massing: Element = {
  id: "m1",
  name: "Fin",
  type: "massing",
  origin: [0, 0, 0],
  size: [600, 300, 1000],
  properties: {},
};

const copiesOf = (element: Element, stops: RailStop[], options: Parameters<typeof arrayAlong>[2]) => {
  const result = arrayAlong(element, stops, options, []);
  if (!result.ok) throw new Error(result.error);
  return result.copies;
};

describe("arrayAlong", () => {
  it("centres a copy on each stop and keeps the element's size", () => {
    const copies = copiesOf(column, stopsOf(straight, { count: 3 }), { align: false });
    expect(copies.map((c) => c.position)).toEqual([
      [0, 0],
      [1500, 0],
      [3000, 0],
    ]);
    expect(copies.every((c) => c.section === undefined)).toBe(true);
  });

  it("turns each copy to run the way the rail does", () => {
    const bent: Point3Mm[] = [
      [0, 0, 0],
      [1000, 0, 0],
      [1000, 1000, 0],
    ];
    const copies = copiesOf(column, stopsOf(bent, { spacing: 1000 }), { align: true });
    expect(copies.map((c) => c.rotationDeg)).toEqual([undefined, 90, 90]);
  });

  it("adds the element's own turn to the rail's", () => {
    const turned = { ...column, rotationDeg: 30 } as Element;
    const copies = copiesOf(
      turned,
      stopsOf(
        [
          [0, 0, 0],
          [0, 1000, 0],
        ],
        { count: 2 },
      ),
      { align: true },
    );
    expect(copies.map((c) => c.rotationDeg)).toEqual([120, 120]);
  });

  it("tapers the width from 15 cm to 5 cm over a rail, every 30 cm", () => {
    const stops = stopsOf(straight, { spacing: 300 });
    const copies = copiesOf(massing, stops, { align: true, width: { from: 150, to: 50 } });
    const widths = copies.map((c) => (c.size as number[])[1]);
    expect(widths[0]).toBeCloseTo(150);
    expect(widths.at(-1)).toBeCloseTo(50);
    expect(widths).toHaveLength(11);
    for (let i = 1; i < widths.length; i++) expect(widths[i] as number).toBeLessThan(widths[i - 1] as number);
    // The length along the rail and the height are the module's.
    expect(copies.every((c) => (c.size as number[])[0] === 600 && (c.size as number[])[2] === 1000)).toBe(
      true,
    );
  });

  it("keeps a tapered massing centred on its stop", () => {
    const stops = stopsOf(straight, { count: 2 });
    const [first, last] = copiesOf(massing, stops, { align: false, width: { from: 100, to: 300 } });
    // 600 by 100 centred on (0, 0), and 600 by 300 centred on (3000, 0).
    expect(first?.origin).toEqual([-300, -50, 0]);
    expect(last?.origin).toEqual([2700, -150, 0]);
  });

  it("scales the whole element along the array", () => {
    const stops = stopsOf(straight, { count: 3 });
    const copies = copiesOf(column, stops, { align: false, scale: { from: 1, to: 0.5 } });
    expect(copies.map((c) => c.height)).toEqual([undefined, 2400 * 0.75, 2400 * 0.5]);
  });

  it("lifts copies with a rail that climbs", () => {
    const ramp: Point3Mm[] = [
      [0, 0, 1000],
      [3000, 0, 1500],
    ];
    const copies = copiesOf(column, stopsOf(ramp, { count: 2 }), { align: false });
    expect(copies.map((c) => c.base)).toEqual([undefined, 500]);
  });

  it("refuses a width on an element that has none, and a width or scale that reaches zero", () => {
    const wall: Element = {
      id: "w",
      name: "Wall",
      type: "wall",
      start: [0, 0],
      end: [1000, 0],
      height: 2000,
      thickness: 100,
      properties: {},
    };
    const stops = stopsOf(straight, { count: 2 });
    expect(arrayAlong(wall, stops, { align: false, width: { from: 100, to: 50 } }, [])).toMatchObject({
      ok: false,
    });
    expect(arrayAlong(massing, stops, { align: false, width: { from: 100, to: 0 } }, [])).toMatchObject({
      ok: false,
    });
    expect(arrayAlong(massing, stops, { align: false, scale: { from: 1, to: -1 } }, [])).toMatchObject({
      ok: false,
    });
  });
});
