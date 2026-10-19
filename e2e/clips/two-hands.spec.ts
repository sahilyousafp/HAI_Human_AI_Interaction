import { expect, test } from "@playwright/test";
import { framesDuring, startCamera } from "../tracking.ts";

// Plays test-assets/clips/two-hands.mp4 as the camera (see playwright.config.ts).
test("two hands visible: at least 90% of frames report two hands with opposite handedness", async ({
  page,
}) => {
  await page.goto("/");
  await startCamera(page);
  const list = await framesDuring(page, 3000);
  expect(list.length).toBeGreaterThan(20);
  const good = list.filter(
    (f) => f.hands.length === 2 && f.hands.includes("Left") && f.hands.includes("Right"),
  );
  expect(good.length / list.length).toBeGreaterThanOrEqual(0.9);
});

test("debug overlay draws both hands over the mirrored preview", async ({ page }) => {
  await page.goto("/");
  await startCamera(page);
  await page.waitForTimeout(1500);
  await expect(page.locator(".preview")).toHaveScreenshot("two-hands-overlay.png", {
    maxDiffPixelRatio: 0.04,
  });
});
