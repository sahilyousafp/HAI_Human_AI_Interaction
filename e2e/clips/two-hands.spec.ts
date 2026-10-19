import { expect, test } from "@playwright/test";
import { attachPreview, overlayColorCounts } from "../overlay.ts";
import { framesDuring, startCamera } from "../tracking.ts";

// Plays test-assets/clips/two-hands.mp4 as the camera (see playwright.config.ts).
test("two hands visible: at least 90% of frames report two hands with opposite handedness", async ({
  page,
}) => {
  await page.goto("/");
  await startCamera(page);
  const list = await framesDuring(page, 3000);
  const good = list.filter(
    (f) => f.hands.length === 2 && f.hands.includes("Left") && f.hands.includes("Right"),
  );
  expect(good.length / list.length).toBeGreaterThanOrEqual(0.9);
});

test("debug overlay draws both hands over the mirrored preview", async ({ page }, testInfo) => {
  await page.goto("/");
  await startCamera(page);
  await page.waitForTimeout(1000);
  const counts = await overlayColorCounts(page, ["--hand-left", "--hand-right"]);
  await attachPreview(page, testInfo, "two-hands-overlay");
  // Each skeleton is 21 dots plus 21 bones: a few hundred pixels at least.
  expect(counts["--hand-left"]).toBeGreaterThan(200);
  expect(counts["--hand-right"]).toBeGreaterThan(200);
});
