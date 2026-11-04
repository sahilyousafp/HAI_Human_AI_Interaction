import { describe, expect, it } from "vitest";
import { GPU_EMPTY_FRAME_LIMIT, shouldFallBackToCpu } from "./gpu-fallback.ts";

const base = {
  backend: "GPU" as const,
  fellBack: false,
  everFoundHand: false,
  emptyFrames: GPU_EMPTY_FRAME_LIMIT,
};

describe("shouldFallBackToCpu", () => {
  it("waits for enough empty frames before doubting the GPU", () => {
    expect(shouldFallBackToCpu({ ...base, emptyFrames: GPU_EMPTY_FRAME_LIMIT - 1 })).toBe(false);
    expect(shouldFallBackToCpu(base)).toBe(true);
  });

  it("trusts a GPU that has found a hand even once", () => {
    expect(shouldFallBackToCpu({ ...base, everFoundHand: true })).toBe(false);
  });

  it("falls back only once, and only from the GPU", () => {
    expect(shouldFallBackToCpu({ ...base, fellBack: true })).toBe(false);
    expect(shouldFallBackToCpu({ ...base, backend: "CPU" })).toBe(false);
  });
});
