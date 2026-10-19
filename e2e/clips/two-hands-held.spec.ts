import { expect, test } from "@playwright/test";
import { framesDuring, startCamera } from "../tracking.ts";

// Plays the part of the two-hands recording where both hands stay in view (built by scripts/convert-clips.mjs).
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
