import { expect, test } from "@playwright/test";
import { framesDuring, startCamera } from "../tracking.ts";

// Plays test-assets/clips/one-hand-pinch.mp4: the maintainer raises their RIGHT hand and pinches.
// This pins the absolute handedness convention: the user's right hand must be reported as "Right".
test("a raised right hand is reported as the right hand", async ({ page }) => {
  await page.goto("/");
  await startCamera(page);
  const withHand = (await framesDuring(page, 3000)).filter((f) => f.hands.length > 0);
  expect(withHand.length).toBeGreaterThan(10);
  const right = withHand.filter((f) => f.hands.length === 1 && f.hands[0] === "Right");
  expect(right.length / withHand.length).toBeGreaterThanOrEqual(0.9);
});
