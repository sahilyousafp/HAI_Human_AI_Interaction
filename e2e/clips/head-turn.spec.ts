import { expect, test } from "@playwright/test";
import { framesDuring, startCamera } from "../tracking.ts";

// Plays test-assets/clips/head-turn.mp4 (look left about 30 degrees, then right) as the camera.
// The fake camera loops the clip, so one full loop (8 s) plus margin covers both turns.
test("head turn: yaw goes beyond 15 degrees on both sides", async ({ page }) => {
  await page.goto("/");
  await startCamera(page);
  const yaws = (await framesDuring(page, 9000)).map((f) => f.yaw).filter((y): y is number => y !== null);
  expect(yaws.length).toBeGreaterThan(30);
  // Turning to the user's left is positive yaw, to the right negative (see docs/perception.md).
  expect(Math.max(...yaws)).toBeGreaterThan(15);
  expect(Math.min(...yaws)).toBeLessThan(-15);
});

test("debug overlay draws face points and head axes", async ({ page }) => {
  await page.goto("/");
  await startCamera(page);
  await page.waitForTimeout(1500);
  await expect(page.locator(".preview")).toHaveScreenshot("head-turn-overlay.png", {
    maxDiffPixelRatio: 0.06,
  });
});
