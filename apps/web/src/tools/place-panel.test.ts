import { describe, expect, it } from "vitest";
import { placePanel } from "./place-panel.ts";

const size = { width: 200, height: 100 };
const view = { width: 1000, height: 800 };

describe("placing a panel pinned to a point", () => {
  it("floats centred above the point when that is free", () => {
    expect(placePanel([500, 400], size, view, [])).toEqual({ left: 400, top: 282 });
  });

  it("stays inside the view at every edge", () => {
    expect(placePanel([10, 400], size, view, []).left).toBe(8);
    expect(placePanel([990, 400], size, view, []).left).toBe(792);
    expect(placePanel([500, 10], size, view, []).top).toBe(8);
    expect(placePanel([500, 2000], size, view, []).top).toBe(692);
  });

  it("moves off another panel by the least it can, and covers nothing", () => {
    const bar = { left: 0, top: 0, width: 1000, height: 300 };
    const placed = placePanel([500, 400], size, view, [bar]);
    expect(placed).toEqual({ left: 400, top: 308 });
  });

  it("finds a place between several panels", () => {
    const panels = [
      { left: 0, top: 0, width: 1000, height: 200 },
      { left: 300, top: 200, width: 400, height: 400 },
    ];
    const placed = placePanel([500, 400], size, view, panels);
    const covers = panels.some(
      (b) =>
        placed.left < b.left + b.width &&
        b.left < placed.left + size.width &&
        placed.top < b.top + b.height &&
        b.top < placed.top + size.height,
    );
    expect(covers).toBe(false);
  });

  it("with nowhere free it still stays in the view", () => {
    const placed = placePanel([500, 400], size, view, [{ left: 0, top: 0, width: 1000, height: 800 }]);
    expect(placed).toEqual({ left: 400, top: 282 });
  });
});
