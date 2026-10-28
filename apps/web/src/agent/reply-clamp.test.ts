import { describe, expect, it } from "vitest";
import { clampReply } from "./reply-clamp.ts";

describe("clampReply", () => {
  it("shows a short reply whole", () => {
    expect(clampReply("Done. The wall is 300 thick.")).toEqual({
      shown: "Done. The wall is 300 thick.",
      clipped: false,
    });
  });

  it("cuts a long reply after a whole sentence", () => {
    const text = `${"The slab is placed on level two. ".repeat(12)}End.`;
    const { shown, clipped } = clampReply(text, 100);
    expect(clipped).toBe(true);
    expect(shown.endsWith("level two.")).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(100);
  });

  it("cuts a run-on at a word and says so with an ellipsis", () => {
    const { shown, clipped } = clampReply("word ".repeat(100), 50);
    expect(clipped).toBe(true);
    expect(shown.endsWith("word…")).toBe(true);
  });
});
