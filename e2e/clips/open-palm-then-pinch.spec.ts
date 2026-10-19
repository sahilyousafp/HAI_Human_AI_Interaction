import { expect, test } from "@playwright/test";
import { gestureEvents, startCamera } from "../tracking.ts";

// Plays the open-palm clip followed by the one-hand-pinch clip (built by scripts/convert-clips.mjs).
test("HUD shows engaged after the open palm, then a pinch on the right hand", async ({ page }) => {
  await page.goto("/");
  await startCamera(page);
  await expect(page.getByTestId("hud-engaged")).toHaveAttribute("data-state", "engaged", { timeout: 60_000 });
  // The pinch part follows; a tap or drag on the right hand shows up as the last gesture.
  await expect(page.getByTestId("hud-last-gesture")).toHaveText(/(tap|drag start|drag end) \(right\)/, {
    timeout: 60_000,
  });
  const events = await gestureEvents(page);
  const engagedAt = events.findIndex((e) => e.type === "engaged");
  const pinchAt = events.findIndex((e) => e.type.startsWith("pinch.") && e.hand === "Right");
  expect(engagedAt).toBeGreaterThanOrEqual(0);
  expect(pinchAt).toBeGreaterThan(engagedAt);
});
