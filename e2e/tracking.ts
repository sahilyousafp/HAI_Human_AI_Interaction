import { expect, type Page } from "@playwright/test";

/** Per-frame summary the app exposes in dev builds (window.__HAI_TRACKING__). Never contains pixels. */
export type Summary = {
  seq: number;
  hands: string[];
  face: boolean;
  faceRan: boolean;
  yaw: number | null;
  pitch: number | null;
  captureTs: number;
  inferenceDoneTs: number;
};

export const frames = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __HAI_TRACKING__?: { frames: Summary[] } }).__HAI_TRACKING__?.frames ?? [],
  );

/** Clicks Start camera and waits until tracking frames flow (model loading takes a few seconds on CPU-only CI). */
export async function startCamera(page: Page) {
  await page.getByTestId("camera-toggle").click();
  await expect(page.getByTestId("camera-indicator")).toHaveAttribute("data-state", "on");
  await expect.poll(async () => (await frames(page)).length, { timeout: 45_000 }).toBeGreaterThan(10);
}

/**
 * Frames captured from now on, for at least `minMs` and until at least `minFrames` have arrived.
 * Frame-rate independent: GPU laptops reach 30 fps, CPU-only CI runners about 5 fps.
 */
export async function framesDuring(page: Page, minMs: number, minFrames = 20): Promise<Summary[]> {
  const startSeq = (await frames(page)).at(-1)?.seq ?? -1;
  const since = async () => (await frames(page)).filter((f) => f.seq > startSeq);
  await page.waitForTimeout(minMs);
  await expect
    .poll(async () => (await since()).length, { timeout: 60_000 })
    .toBeGreaterThanOrEqual(minFrames);
  return since();
}

/** Gesture events the app logged in dev builds (window.__HAI_GESTURES__). */
export const gestureEvents = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __HAI_GESTURES__?: { events: Array<{ type: string; ts: number; hand?: string }> };
        }
      ).__HAI_GESTURES__?.events ?? [],
  );
