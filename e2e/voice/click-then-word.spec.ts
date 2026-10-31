import { expect, type Page, test } from "@playwright/test";
import { holdAt, openGround, type Point, releaseAt, toolSnapshot, viewerOf } from "../hands.ts";
import { startVoice } from "./tool-names.ts";

// The fake microphone plays test-assets/speech/click-then-word.wav once from when it opens: a second of silence, a
// click of 60 ms (a cut of speech, too short to count), five seconds of silence, "Measure.", and silence.
// The other hand's long pinch listens and shows the reference ring after a silence. A click must not take the tools
// away for good; words do, and then the ring stays away through the pause after them (the hand points), and letting
// go sends what was said.

const ringState = async (page: Page) => {
  const snapshot = (await toolSnapshot(page)) as unknown as { palette: { hidden: boolean } | null };
  return snapshot.palette ? (snapshot.palette.hidden ? "hidden" : "shown") : "gone";
};

test("a click before a word, and the word: the page keeps answering, the word takes the ring, and the hand points on through the pause", async ({
  page,
}) => {
  const { bridge } = await startVoice(page);
  try {
    const [x, y] = await openGround(page, 2000, 2000);
    const at = (await viewerOf(page, [x + 1000, y + 1000])) as Point;
    await holdAt(page, at, "Left");
    const heldAt = Date.now();
    await expect.poll(() => ringState(page)).toBe("shown");

    // The click comes about a second after the microphone opened, the word six. Watch the ring until the word takes it
    // (it goes and stays away, after 4.5 s). The detector may take the click for a sound too short to count (what the
    // fixture is made to be), in which case the ring never leaves, or just long enough to count, in which case it is
    // treated as speech like any other and the ring is away. Either way the page keeps answering, and the word below
    // is what the rest is about.
    const watching = Date.now();
    for (;;) {
      const state = await ringState(page);
      if (state === "gone" && Date.now() - heldAt > 4500) break;
      if (Date.now() - watching > 30_000) throw new Error("the word never took the ring");
      await page.waitForTimeout(50);
    }

    // "Measure." is being said: the ring is away, and stays away through the silence after it.
    await expect(page.getByTestId("held-chip")).toContainText("Point at what you mean");
    await page.waitForTimeout(2500);
    expect(await ringState(page)).toBe("gone");

    // Letting go with the hand where it was sends what was said: Measure is picked.
    await releaseAt(page, at, "Left");
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "measure", {
      timeout: 60_000,
    });
  } finally {
    await bridge.stop();
  }
});
