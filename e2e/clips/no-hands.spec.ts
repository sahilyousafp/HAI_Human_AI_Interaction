import { expect, test } from "@playwright/test";
import { framesDuring, startCamera } from "../tracking.ts";

// Plays test-assets/clips/no-hands.mp4 as the camera (see playwright.config.ts).
test("no hands visible: no frame reports a hand over 3 seconds", async ({ page }) => {
  await page.goto("/");
  await startCamera(page);
  const list = await framesDuring(page, 3000);
  expect(list.filter((f) => f.hands.length > 0)).toEqual([]);
});
