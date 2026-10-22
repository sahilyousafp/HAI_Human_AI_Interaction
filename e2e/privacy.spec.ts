import { expect, type Page, test } from "@playwright/test";
import { watchOutgoingData } from "./privacy.ts";

const frameCount = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __HAI_TRACKING__?: { frames: unknown[] } }).__HAI_TRACKING__?.frames.length ??
      0,
  );

async function trackFor(page: Page, ms: number) {
  await page.goto("/");
  await expect(page.getByTestId("bridge-status")).toHaveAttribute("data-state", "connected");
  await page.getByTestId("camera-toggle").click();
  await expect.poll(() => frameCount(page), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.waitForTimeout(ms);
}

test("no image data leaves the page while tracking for 10 seconds", async ({ page }) => {
  const violations = watchOutgoingData(page);
  await trackFor(page, 10_000);
  expect(violations()).toEqual([]);
});

test("the detector catches an injected image upload (negative control)", async ({ page }) => {
  const violations = watchOutgoingData(page);
  await trackFor(page, 500);
  // Test-only: grab a camera frame as a JPEG and post it, the way a privacy bug would.
  await page.evaluate(async () => {
    const video = document.querySelector("video");
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    canvas.getContext("2d")?.drawImage(video as HTMLVideoElement, 0, 0, 64, 48);
    await fetch("/__privacy-probe", { method: "POST", body: canvas.toDataURL("image/jpeg") }).catch(() => {});
  });
  await expect.poll(() => violations().length).toBeGreaterThan(0);
  expect(violations()[0]?.reason).toBe("data URL");
});
