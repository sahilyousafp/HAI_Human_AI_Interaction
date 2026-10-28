import { expect, test } from "@playwright/test";
import { handEvent, holdAt, openGround, type Point, viewerOf } from "../hands.ts";
import { closeSettings, openSettings } from "../settings.ts";
import { findElementOnScreen } from "../viewer.ts";
import { startVoice } from "./tool-names.ts";

// The fake microphone plays test-assets/speech/copy-this-there.wav once: "Copy this.", a pause, then "There."

test("Copy this there, and A pause during a held pinch: one request, with the column as this and the rested point as P1", async ({
  page,
}) => {
  const { bridge, received } = await startVoice(page);
  try {
    // Hands that do not snap to models, so the hand rests on bare ground, not on the nearest building.
    await openSettings(page, "features");
    const snap = page.getByTestId("feature-snapToModels");
    if ((await snap.getAttribute("aria-checked")) === "true") await snap.click();
    await closeSettings(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    const column = await findElementOnScreen(page, "col-a1");
    const [x, y] = await openGround(page, 2000, 2000, { empty: true });
    const there = (await viewerOf(page, [x + 1000, y + 1000])) as Point;
    await holdAt(page, column, "Left");
    await expect(page.getByTestId("held-chip")).toContainText("Point at what you mean", { timeout: 60_000 });
    // While speaking, the hand goes to the ground and rests there.
    for (let i = 0; i < 8; i++) {
      await handEvent(page, "Left", "pinch.drag.update", there);
      await page.waitForTimeout(100);
    }
    await expect(page.getByTestId("held-point")).toHaveText("P1");
    await page.waitForTimeout(4000); // "There." after the pause, and the silence after it
    await handEvent(page, "Left", "pinch.drag.end", there);
    await expect(page.getByTestId("held-chip")).toContainText("Sent - shake to stop", { timeout: 30_000 });
    // One request with both parts; the column is "this" and the rested point is P1, in millimetres.
    const sent = await expect
      .poll(() => received().find((t) => /copy this/i.test(t)) ?? "")
      .toMatch(/copy this\W+there/i)
      .then(() => received().find((t) => /copy this/i.test(t)) ?? "");
    expect(sent).toContain('target ("this"): column col-a1');
    expect(sent).toMatch(/points: P1 -?\d+, -?\d+, 0 mm/);
    expect(received().filter((t) => /copy this|there/i.test(t))).toHaveLength(1);
  } finally {
    await bridge.stop();
  }
});
