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

test("a mirrored camera setting flips the image before tracking, and the camera picker lists the camera", async ({
  page,
}) => {
  await page.goto("/");
  await startCamera(page);
  await expect(page.getByTestId("hud-camera")).toHaveText(/^640 x 480, \d+ fps$/);
  // The fake camera is listed by name once permission is granted.
  await expect(page.getByTestId("camera-select").locator("option")).not.toHaveCount(1);

  // Telling the app this (unmirrored) camera is mirrored makes it flip the image, so the right hand now reads as
  // the left: proof the flip happens before tracking, where handedness is decided.
  await page.getByTestId("camera-mirrored").check();
  const leftShare = async () => {
    const withHand = (await framesDuring(page, 1500, 10)).filter((f) => f.hands.length === 1);
    return withHand.filter((f) => f.hands[0] === "Left").length / Math.max(1, withHand.length);
  };
  await expect.poll(leftShare, { timeout: 60_000 }).toBeGreaterThanOrEqual(0.9);

  // The setting is remembered for this camera.
  await page.reload();
  await expect(page.getByTestId("camera-mirrored")).toBeChecked();
});
