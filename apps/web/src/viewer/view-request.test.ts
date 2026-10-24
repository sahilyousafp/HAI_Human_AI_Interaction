import { describe, expect, it } from "vitest";
import type { Turntable } from "./turntable.ts";
import { between, resolveView } from "./view-request.ts";

const now: Turntable = { target: [20, 15, 3], azimuth: 305, elevation: 32, distance: 70 };
const nothing = () => null;

describe("resolveView", () => {
  it("turns to the south-west: azimuth 225, everything else stays", () => {
    expect(resolveView(now, { azimuth: 225 }, nothing)).toEqual({ ...now, azimuth: 225 });
  });

  it("wraps an azimuth into 0 to 360", () => {
    expect(resolveView(now, { azimuth: -90 }, nothing).azimuth).toBe(270);
    expect(resolveView(now, { azimuth: 450 }, nothing).azimuth).toBe(90);
  });

  it("tilts within the limits, and moves nearer or further in millimetres", () => {
    expect(resolveView(now, { elevation: 60, distance: 30_000 }, nothing)).toMatchObject({
      elevation: 60,
      distance: 30,
    });
    expect(resolveView(now, { distance: 1 }, nothing).distance).toBe(2); // not closer than the viewer allows
    expect(resolveView(now, { distance: 9_000_000 }, nothing).distance).toBe(2000);
    expect(resolveView(now, { elevation: 200 } as never, nothing).elevation).toBe(89);
  });

  it("looks at a point given in millimetres", () => {
    expect(resolveView(now, { target: [4000, 8000, 1500] }, nothing).target).toEqual([4, 8, 1.5]);
  });

  it("frames elements: their box is centred and in view, from the angle the user has", () => {
    const view = resolveView(now, { frame: ["a", "b"] }, (ids) => {
      expect(ids).toEqual(["a", "b"]);
      return { min: [0, 0, 0], max: [10_000, 10_000, 0] };
    });
    expect(view.target).toEqual([5, 5, 0]);
    expect(view.azimuth).toBe(305);
    expect(view.elevation).toBe(32);
    expect(view.distance).toBeGreaterThan(14);
  });

  it("framing, then a different angle asked for as well", () => {
    const view = resolveView(now, { frame: ["a"], azimuth: 225, elevation: 20 }, () => ({
      min: [0, 0, 0],
      max: [2000, 2000, 2000],
    }));
    expect(view).toMatchObject({ azimuth: 225, elevation: 20, target: [1, 1, 1] });
  });

  it("framing ids that are not found leaves the view where it is", () => {
    expect(resolveView(now, { frame: ["ghost"] }, nothing)).toEqual(now);
  });
});

describe("between", () => {
  const target: Turntable = { target: [0, 0, 0], azimuth: 225, elevation: 20, distance: 30 };

  it("starts at the first view, ends at the second, and is on the way in between", () => {
    expect(between(now, target, 0)).toEqual(now);
    expect(between(now, target, 1)).toEqual(target);
    const half = between(now, target, 0.5);
    expect(half.distance).toBeGreaterThan(30);
    expect(half.distance).toBeLessThan(70);
  });

  it("turns the short way round the circle", () => {
    const a: Turntable = { ...now, azimuth: 350 };
    const b: Turntable = { ...now, azimuth: 10 };
    const half = between(a, b, 0.5).azimuth;
    expect(half === 0 || Math.abs(half - 360) < 1e-9).toBe(true);
  });

  it("eases: slow at the start", () => {
    expect(70 - between(now, target, 0.1).distance).toBeLessThan((70 - 30) * 0.1);
  });
});
