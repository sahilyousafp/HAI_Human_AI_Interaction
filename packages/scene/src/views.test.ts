import { describe, expect, it } from "vitest";
import { ORTHO_VIEWS, VIEW_MODES, viewMatches, workPlane } from "./views.ts";

describe("orthographic views", () => {
  it("six named views and the perspective, each with a plane", () => {
    expect(VIEW_MODES).toEqual(["perspective", "top", "bottom", "front", "back", "left", "right"]);
    expect(workPlane("perspective")).toBe("xy");
    expect(workPlane("top")).toBe("xy");
    expect(workPlane("bottom")).toBe("xy");
    expect(workPlane("front")).toBe("xz");
    expect(workPlane("back")).toBe("xz");
    expect(workPlane("left")).toBe("yz");
    expect(workPlane("right")).toBe("yz");
  });

  it("each view sits on its side: Front south, Right east, Top above, with the horizon level", () => {
    expect(ORTHO_VIEWS.front).toMatchObject({ azimuth: 270, elevation: 0 });
    expect(ORTHO_VIEWS.back).toMatchObject({ azimuth: 90, elevation: 0 });
    expect(ORTHO_VIEWS.right).toMatchObject({ azimuth: 0, elevation: 0 });
    expect(ORTHO_VIEWS.left).toMatchObject({ azimuth: 180, elevation: 0 });
    expect(ORTHO_VIEWS.top.elevation).toBeGreaterThan(89.9);
    expect(ORTHO_VIEWS.bottom.elevation).toBeLessThan(-89.9);
  });

  it("a camera still matches its view after panning and zooming, and stops matching once it is orbited", () => {
    expect(viewMatches("front", { azimuth: 270, elevation: 0 })).toBe(true);
    expect(viewMatches("front", { azimuth: 270.02, elevation: 0.03 })).toBe(true);
    expect(viewMatches("front", { azimuth: 273, elevation: 0 })).toBe(false);
    expect(viewMatches("front", { azimuth: 270, elevation: 5 })).toBe(false);
    expect(viewMatches("top", { azimuth: 270, elevation: 89 })).toBe(false); // the orbit clamp
    expect(viewMatches("right", { azimuth: 359.98, elevation: 0 })).toBe(true); // across the wrap
    expect(viewMatches("perspective", { azimuth: 12, elevation: 34 })).toBe(true);
  });
});
