import { afterEach, describe, expect, it, vi } from "vitest";
import { siteUrl } from "./site-url.ts";

describe("the address of a file the site serves", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is at the root of the origin when the app is", () => {
    vi.stubGlobal("location", { origin: "https://example.test" });
    expect(siteUrl("/models/hand_landmarker.task")).toBe(
      `https://example.test${import.meta.env.BASE_URL}models/hand_landmarker.task`,
    );
  });

  it("takes a path with or without its leading slash", () => {
    vi.stubGlobal("location", { origin: "https://example.test" });
    expect(siteUrl("rhino3dm")).toBe(siteUrl("/rhino3dm"));
  });
});
