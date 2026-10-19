import type { GestureEvent } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { initialInput, navigate } from "./navigation.ts";
import { cameraPosition, ELEVATION_MAX, orbit, pan, type Turntable, zoom } from "./turntable.ts";

const start: Turntable = { target: [10, 5, 3], azimuth: 30, elevation: 30, distance: 50 };
const drag = (dx: number, dy: number): GestureEvent => ({
  type: "pinch.drag.update",
  ts: 1,
  confidence: 1,
  hand: "Right",
  position: [0.5, 0.5],
  delta: [dx, dy],
});
const two = (
  type: "twohand.start" | "twohand.update",
  distance: number,
  midpoint: [number, number],
): GestureEvent => ({
  type,
  ts: 1,
  confidence: 1,
  hand: "both",
  distance,
  midpoint,
  angle: 0,
});

describe("one-hand pinch drag orbits (spec)", () => {
  it("drag right orbits: azimuth decreases (like dragging the model with the mouse) and the target stays put", () => {
    const next = navigate(start, initialInput(), drag(0.2, 0));
    const change = ((next.azimuth - start.azimuth + 540) % 360) - 180; // the short way round
    expect(change).toBeCloseTo(-0.2 * 270, 9);
    expect(next.target).toEqual(start.target);
  });

  it("drag down raises the view", () => {
    expect(navigate(start, initialInput(), drag(0, 0.1)).elevation).toBeGreaterThan(start.elevation);
  });

  it("elevation is clamped at 89 degrees", () => {
    let t = start;
    for (let i = 0; i < 20; i++) t = navigate(t, initialInput(), drag(0, 0.2)); // dragging down raises the view
    expect(t.elevation).toBe(ELEVATION_MAX);
  });
});

describe("two-hand pinch zooms and pans (spec)", () => {
  it("spread zooms in: camera distance decreases", () => {
    const input = initialInput();
    let t = navigate(start, input, two("twohand.start", 0.3, [0.5, 0.5]));
    t = navigate(t, input, two("twohand.update", 0.45, [0.5, 0.5]));
    expect(t.distance).toBeLessThan(start.distance);
  });

  it("midpoint move pans: the target moves and distance stays within 2%", () => {
    const input = initialInput();
    let t = navigate(start, input, two("twohand.start", 0.3, [0.5, 0.5]));
    t = navigate(t, input, two("twohand.update", 0.3, [0.4, 0.5]));
    expect(t.target).not.toEqual(start.target);
    expect(Math.abs(t.distance - start.distance) / start.distance).toBeLessThan(0.02);
  });

  it("the view pans opposite to the hands: moving them left pans as a screen pan to the right", () => {
    const input = initialInput();
    let t = navigate(start, input, two("twohand.start", 0.3, [0.5, 0.5]));
    t = navigate(t, input, two("twohand.update", 0.3, [0.4, 0.45]));
    const expected = pan(start, 0.1 * 1.2, -0.05 * 1.2);
    for (const [i, v] of t.target.entries()) expect(v).toBeCloseTo(expected.target[i] ?? 0, 9);
  });
});

describe("turntable", () => {
  it("camera position sits at the given distance from the target", () => {
    const [x, y, z] = cameraPosition(start);
    expect(Math.hypot(x - 10, y - 5, z - 3)).toBeCloseTo(50, 9);
    expect(z).toBeGreaterThan(3); // Z is up
  });

  it("pan keeps the camera-to-target distance", () => {
    const before = cameraPosition(start);
    const t = pan(start, 0.1, 0.05);
    const after = cameraPosition(t);
    type V = [number, number, number];
    const d = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(d(after, t.target)).toBeCloseTo(d(before, start.target), 9);
  });

  it("azimuth wraps and zoom is clamped", () => {
    expect(orbit(start, 350, 0).azimuth).toBeCloseTo(20, 9);
    expect(zoom(start, 1e-6).distance).toBe(2);
  });
});
