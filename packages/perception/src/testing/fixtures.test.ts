import { describe, expect, it } from "vitest";
import { FIXTURE_CLIPS, loadFixture } from "./fixtures.ts";

describe("landmark fixtures", () => {
  it.each(FIXTURE_CLIPS)("%s loads, validates and has ordered timestamps", (clip) => {
    const frames = loadFixture(clip);
    expect(frames.length).toBeGreaterThan(50);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]?.captureTs ?? 0).toBeGreaterThan(frames[i - 1]?.captureTs ?? 0);
    }
  });

  it("matches what each clip shows", () => {
    const share = (clip: (typeof FIXTURE_CLIPS)[number], test: (hands: string[]) => boolean) => {
      const frames = loadFixture(clip);
      return frames.filter((f) => test(f.hands.map((h) => h.handedness))).length / frames.length;
    };
    expect(share("no-hands", (h) => h.length === 0)).toBe(1);
    // Full loops include hands rising into view, so these sit a little below the steady-state share.
    expect(share("two-hands", (h) => h.length === 2)).toBeGreaterThan(0.8);
    expect(share("one-hand-pinch", (h) => h.length === 1 && h[0] === "Right")).toBeGreaterThan(0.8);
  });
});
