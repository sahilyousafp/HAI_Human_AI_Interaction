import { expect, test } from "@playwright/test";
import { attachPreview, overlayColorCounts } from "../overlay.ts";
import { gestureEvents, startCamera } from "../tracking.ts";

// Plays test-assets/clips/two-hands.mp4: open palms, two-hand pinches, fists, then hands lowering out of view.
// The steady two-hands scenario runs on the trimmed clip in two-hands-held.spec.ts.
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

test("gesture events arrive in order: engaged, then two-hand pinches, timestamps never going back", async ({
  page,
}) => {
  await page.goto("/");
  await startCamera(page);
  // The clip opens with open palms (engage), then pinches with both hands.
  await expect
    .poll(async () => (await gestureEvents(page)).some((e) => e.type === "twohand.start"), {
      timeout: 60_000,
    })
    .toBe(true);
  const events = await gestureEvents(page);
  expect(events[0]?.type).toBe("engaged");
  for (let i = 1; i < events.length; i++)
    expect(events[i]?.ts ?? 0).toBeGreaterThanOrEqual(events[i - 1]?.ts ?? 0);
});
