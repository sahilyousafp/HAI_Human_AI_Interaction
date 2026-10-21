import { describe, expect, it } from "vitest";
import { DEFAULT_FEATURES, FEATURE_IDS, resolveFeatures } from "./features.ts";

describe("features", () => {
  it("every feature is on until the user turns it off", () => {
    expect(FEATURE_IDS.every((id) => DEFAULT_FEATURES[id])).toBe(true);
    expect(resolveFeatures(null)).toEqual(DEFAULT_FEATURES);
  });

  it("stored choices apply, and unknown names are ignored", () => {
    const features = resolveFeatures({ createTools: false, teleport: false });
    expect(features.createTools).toBe(false);
    expect(features.voice).toBe(true);
    expect(Object.keys(features)).toEqual(FEATURE_IDS);
  });
});
