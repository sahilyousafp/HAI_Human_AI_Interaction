import { expect, type Page } from "@playwright/test";

/** Per-frame summary the app exposes in dev builds (window.__AEX_TRACKING__). Never contains pixels. */
export type Summary = {
  seq: number;
  hands: string[];
  face: boolean;
  faceRan: boolean;
  yaw: number | null;
  captureTs: number;
  inferenceDoneTs: number;
};

export const frames = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __AEX_TRACKING__?: { frames: Summary[] } }).__AEX_TRACKING__?.frames ?? [],
  );

/** Clicks Start camera and waits until tracking frames flow (model loading takes a few seconds on CPU-only CI). */
export async function startCamera(page: Page) {
  await page.getByTestId("camera-toggle").click();
  await expect(page.getByTestId("camera-indicator")).toHaveAttribute("data-state", "on");
  await expect.poll(async () => (await frames(page)).length, { timeout: 45_000 }).toBeGreaterThan(10);
}

/** Frames captured during the next `ms` milliseconds. */
export async function framesDuring(page: Page, ms: number): Promise<Summary[]> {
  const startSeq = (await frames(page)).at(-1)?.seq ?? -1;
  await page.waitForTimeout(ms);
  return (await frames(page)).filter((f) => f.seq > startSeq);
}
