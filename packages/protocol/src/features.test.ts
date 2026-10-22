import { describe, expect, it } from "vitest";
import { DEFAULT_FEATURES, FEATURE_IDS, FEATURES, resolveFeatures } from "./features.ts";

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

  it("Snap to buttons is a feature, on by default, with a description", () => {
    expect(FEATURE_IDS).toContain("snapToButtons");
    expect(resolveFeatures(null).snapToButtons).toBe(true);
    expect(resolveFeatures({ snapToButtons: false }).snapToButtons).toBe(false);
    const ids = FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
