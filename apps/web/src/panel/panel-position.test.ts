import { describe, expect, it } from "vitest";
import { clampToWindow } from "./panel-position.ts";

const win = { width: 1280, height: 800 };
const size = { width: 320, height: 240 };

describe("clampToWindow", () => {
  it("leaves a position that is inside the window alone", () => {
    expect(clampToWindow({ x: 428, y: 76 }, size, win)).toEqual({ x: 428, y: 76 });
  });

  it("keeps the panel off every edge, with a margin", () => {
    expect(clampToWindow({ x: -500, y: -500 }, size, win)).toEqual({ x: 8, y: 8 });
    const far = clampToWindow({ x: 5000, y: 5000 }, size, win);
    expect(far.x + size.width).toBeLessThanOrEqual(win.width - 8);
    // The header and the footer are inside the window too, not only the frame.
    expect(far.y + size.height + 112).toBeLessThanOrEqual(win.height);
  });

  it("a window smaller than the panel puts it at the top left", () => {
    expect(clampToWindow({ x: 300, y: 300 }, size, { width: 200, height: 200 })).toEqual({ x: 8, y: 8 });
  });
});
