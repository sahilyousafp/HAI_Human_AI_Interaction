import { expect, type Page, test } from "@playwright/test";
import { holdAt, openGround, type Point, releaseAt, toolSnapshot, viewerOf } from "../hands.ts";
import { startVoice } from "./tool-names.ts";

// The fake microphone plays test-assets/speech/click-then-word.wav once from when it opens: a second of silence, a
// click of 100 ms (a cut of speech, too short to count), a second and a half of silence, "Measure.", and silence.
// The other hand's long pinch listens and shows the reference ring after a silence; speech takes the ring away while
// it goes on, and the ring comes back once it stops.

const ringState = async (page: Page) => {
  const snapshot = (await toolSnapshot(page)) as unknown as { palette: { hidden: boolean } | null };
  return snapshot.palette ? (snapshot.palette.hidden ? "hidden" : "shown") : "gone";
};

test("a click does not take the tools away; a spoken word does, and they come back when it stops", async ({
  page,
}) => {
  const { bridge } = await startVoice(page);
  try {
    const [x, y] = await openGround(page, 2000, 2000);
    const at = (await viewerOf(page, [x + 1000, y + 1000])) as Point;
    await holdAt(page, at, "Left");
    const heldAt = Date.now();
    await expect.poll(() => ringState(page)).toBe("shown");

    // The click comes about a second after the microphone opened, the word two and a half: the ring stays through the
    // click, and this looks only until 2 s after the hold, well before the word.
    const seen = new Set<string>();
    const until = heldAt + 2000;
    while (Date.now() < until) {
      seen.add(await ringState(page));
      await page.waitForTimeout(50);
    }
    expect(seen).toEqual(new Set(["shown"]));

    // "Measure." follows: the ring goes while it is said, and is back once it is over.
    await expect.poll(() => ringState(page), { timeout: 20_000 }).toBe("gone");
    await expect(page.getByTestId("held-chip")).toContainText("Point at what you mean");
    await expect.poll(() => ringState(page), { timeout: 20_000 }).toBe("shown");

    // Letting go with the hand where it was still sends what was said: Measure is picked.
    await releaseAt(page, at, "Left");
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "measure", {
      timeout: 60_000,
    });
  } finally {
    await bridge.stop();
  }
});
