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

test("the Detection card reports the right hand's detection rate, its pinch distance and the response time", async ({
  page,
}) => {
  await page.goto("/");
  await startCamera(page);
  await framesDuring(page, 3000);
  // The clip loops; the right hand is in view most of each loop and the left hand never.
  const percent = async (id: string) => Number((await page.getByTestId(id).textContent())?.replace("%", ""));
  await expect.poll(() => percent("detect-right"), { timeout: 30_000 }).toBeGreaterThan(50);
  expect(await percent("detect-left")).toBe(0);
  await expect(page.getByTestId("pinch-right-ratio")).toHaveText(/^\d\.\d\d/);
  await expect(page.getByTestId("detect-camera-to-gesture")).toHaveText(/^\d+ ms$/);
  // Studio-effect style constraints were requested; the fake camera reports them, so the state is known.
  await expect(page.getByTestId("hud-camera-effects")).not.toHaveText("-");
});
