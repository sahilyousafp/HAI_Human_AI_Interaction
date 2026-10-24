import { describe, expect, it } from "vitest";
import { DEFAULT_FEATURES, FEATURE_IDS, FEATURES, resolveFeatures } from "./features.ts";

describe("features", () => {
  it("every feature is on until the user turns it off, except those that say they start off", () => {
    const startOff = FEATURES.filter((f) => "defaultOn" in f && f.defaultOn === false).map((f) => f.id);
    expect(startOff).toEqual(["pointCapture"]);
    expect(FEATURE_IDS.filter((id) => !DEFAULT_FEATURES[id])).toEqual(startOff);
    expect(resolveFeatures(null)).toEqual(DEFAULT_FEATURES);
  });

  it("Snap to models is on by default and Number what I point at is off until turned on", () => {
    expect(resolveFeatures(null).snapToModels).toBe(true);
    expect(resolveFeatures(null).pointCapture).toBe(false);
    expect(resolveFeatures({ pointCapture: true }).pointCapture).toBe(true);
    expect(resolveFeatures({ snapToModels: false }).snapToModels).toBe(false);
  });

  it("stored choices apply, and unknown names are ignored", () => {
    const features = resolveFeatures({ createTools: false, teleport: false });
    expect(features.createTools).toBe(false);
    expect(features.voice).toBe(true);
    expect(Object.keys(features)).toEqual(FEATURE_IDS);
  });

  it("Generated panels is a feature, on by default, that can be switched off", () => {
    const feature = FEATURES.find((f) => f.id === "generatedPanels");
    expect(feature?.label).toBe("Generated panels");
    expect(feature?.description).toBeTruthy();
    expect(resolveFeatures(null).generatedPanels).toBe(true);
    expect(resolveFeatures({ generatedPanels: false }).generatedPanels).toBe(false);
  });

  it("Snap to buttons is a feature, on by default, with a description", () => {
    expect(FEATURE_IDS).toContain("snapToButtons");
    expect(resolveFeatures(null).snapToButtons).toBe(true);
    expect(resolveFeatures({ snapToButtons: false }).snapToButtons).toBe(false);
    const ids = FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
