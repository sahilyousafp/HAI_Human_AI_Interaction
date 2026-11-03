import type { Point3Mm } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import {
  type LineElement,
  linePointAt,
  linePointMoved,
  linePointRemoved,
  lineSpanAt,
  type ScreenOf,
} from "./line-edit.ts";

const line = (id: string, points: Point3Mm[], closed = false): LineElement => ({
  id,
  name: id,
  type: "line",
  properties: {},
  points,
  closed,
});

/** One pixel per millimetre, looking straight down. */
const screenOf: ScreenOf = ([x, y]) => [x, y];

describe("finding a line on screen", () => {
  const corner = line("corner", [
    [0, 0, 0],
    [100, 0, 0],
    [100, 100, 0],
  ]);

  it("finds the nearest point within reach, and nothing beyond it", () => {
    expect(linePointAt([corner], screenOf, [98, 3], 24)).toEqual({ id: "corner", index: 1 });
    expect(linePointAt([corner], screenOf, [50, 0], 24)).toBeNull();
  });

  it("skips a point behind the camera", () => {
    expect(linePointAt([corner], () => null, [0, 0], 24)).toBeNull();
  });

  it("finds the span under a pointer beside it, with the point of the line there", () => {
    expect(lineSpanAt([corner], screenOf, [50, 8], 12)).toEqual({ id: "corner", point: [50, 0, 0] });
    expect(lineSpanAt([corner], screenOf, [50, 20], 12)).toBeNull();
  });

  it("gives the height along the span", () => {
    const up = line("up", [
      [0, 0, 0],
      [100, 0, 1000],
    ]);
    expect(lineSpanAt([up], screenOf, [25, 2], 12)?.point).toEqual([25, 0, 250]);
  });

  it("counts the span back to the start only when the line is closed", () => {
    const open = { ...corner };
    const closed = { ...corner, closed: true };
    expect(lineSpanAt([open], screenOf, [50, 50], 5)).toBeNull();
    expect(lineSpanAt([closed], screenOf, [50, 50], 5)?.id).toBe("corner");
  });
});

describe("editing a line's points", () => {
  const points: Point3Mm[] = [
    [0, 0, 0],
    [100, 0, 0],
    [100, 100, 0],
  ];

  it("moves one point and leaves the others", () => {
    expect(linePointMoved(line("l", points), 1, [5, 5, 5]).points).toEqual([
      [0, 0, 0],
      [5, 5, 5],
      [100, 100, 0],
    ]);
  });

  it("removes one point", () => {
    expect(linePointRemoved(line("l", points), 1)).toEqual({
      points: [
        [0, 0, 0],
        [100, 100, 0],
      ],
      closed: false,
    });
  });

  it("opens a closed line left with two points, and keeps one with enough closed", () => {
    expect(linePointRemoved(line("l", points, true), 0)?.closed).toBe(false);
    const four: Point3Mm[] = [...points, [0, 100, 0]];
    expect(linePointRemoved(line("l", four, true), 0)?.closed).toBe(true);
  });

  it("will not leave one point", () => {
    expect(linePointRemoved(line("l", points.slice(0, 2)), 0)).toBeNull();
  });
});
