import { expect, type Page, test } from "@playwright/test";
import { frames, startCamera } from "./tracking.ts";

// These tests use Chromium's built-in fake camera (a synthetic pattern with no hands and no face).
// Scenarios that need real hands or a face run against recorded clips in e2e/clips/.

/** Wraps getUserMedia to count calls and keep the returned streams, so tests can inspect them. */
const instrumentCamera = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __gum: { calls: number; streams: MediaStream[] } };
    w.__gum = { calls: 0, streams: [] };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      w.__gum.calls += 1;
      const stream = await original(constraints);
      w.__gum.streams.push(stream);
      return stream;
    };
  });

const failCamera = (page: Page, errorName: string) =>
  page.addInitScript((name) => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("simulated", name);
    };
  }, errorName);

test.describe("camera lifecycle", () => {
  test("no camera access on page load", async ({ page }) => {
    await instrumentCamera(page);
    await page.goto("/");
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => (window as unknown as { __gum: { calls: number } }).__gum.calls)).toBe(
      0,
    );
    await expect(page.getByTestId("camera-indicator")).toHaveAttribute("data-state", "off");
  });

  test("indicator follows the camera and stop ends every track", async ({ page }) => {
    await instrumentCamera(page);
    await page.goto("/");
    await startCamera(page);
    await page.getByTestId("camera-toggle").click();
    await expect(page.getByTestId("camera-indicator")).toHaveAttribute("data-state", "off");
    const states = await page.evaluate(() =>
      (window as unknown as { __gum: { streams: MediaStream[] } }).__gum.streams.flatMap((s) =>
        s.getTracks().map((t) => t.readyState),
      ),
    );
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((s) => s === "ended")).toBe(true);
  });
});

test.describe("camera failures explain the fix", () => {
  for (const [errorName, kind, text] of [
    ["NotAllowedError", "denied", "permission was denied"],
    ["NotFoundError", "not-found", "No camera was found"],
    ["NotReadableError", "in-use", "used by another app"],
  ] as const) {
    test(`${errorName} shows "${kind}" with a recovery step`, async ({ page }) => {
      await failCamera(page, errorName);
      await page.goto("/");
      await page.getByTestId("camera-toggle").click();
      const error = page.getByTestId("camera-error");
      await expect(error).toHaveAttribute("data-kind", kind);
      await expect(error).toContainText(text);
      await expect(page.getByTestId("camera-indicator")).toHaveAttribute("data-state", "off");
      // The app stays usable: the camera can be retried and the shell still works.
      await expect(page.getByTestId("camera-toggle")).toBeEnabled();
      await expect(page.getByTestId("bridge-status")).toBeVisible();
    });
  }
});

test.describe("tracking on the fake camera", () => {
  test("no hands visible: no frame reports a hand", async ({ page }) => {
    await page.goto("/");
    await startCamera(page);
    await page.waitForTimeout(3000);
    const recent = (await frames(page)).slice(-60);
    expect(recent.length).toBeGreaterThan(20);
    expect(recent.every((f) => f.hands.length === 0)).toBe(true);
  });

  test("timestamps: capture before inference-done, capture increasing", async ({ page }) => {
    await page.goto("/");
    await startCamera(page);
    const list = await frames(page);
    for (const f of list) expect(f.captureTs).toBeLessThanOrEqual(f.inferenceDoneTs);
    for (let i = 1; i < list.length; i++) {
      expect(list[i]?.captureTs ?? 0).toBeGreaterThan(list[i - 1]?.captureTs ?? 0);
    }
  });

  test("HUD reports frame rate, inference time and backend, refreshed each second", async ({ page }) => {
    await page.goto("/");
    await startCamera(page);
    await expect(page.getByTestId("hud-backend")).toHaveText(/^(GPU|CPU)$/);
    await expect(page.getByTestId("hud-fps")).toHaveText(/\d+ fps/);
    await expect(page.getByTestId("hud-inference")).toHaveText(/\d+\.\d ms/);
    const before = await page.getByTestId("hud-frames").textContent();
    await page.waitForTimeout(1500);
    expect(await page.getByTestId("hud-frames").textContent()).not.toBe(before);
  });

  test("face tracking backs off to alternate frames under load, hands stay on every frame", async ({
    page,
  }) => {
    // 45 ms of extra work per frame keeps the rate below 24 fps on any machine.
    await page.goto("/?perfDelay=45");
    await startCamera(page);
    await expect(page.getByTestId("hud-face-cadence")).toHaveText("every 2nd frame", { timeout: 20_000 });
    // Only judge frames processed after the back-off; the rate under load varies by machine.
    const switchedAt = (await frames(page)).at(-1)?.seq ?? 0;
    await expect
      .poll(async () => (await frames(page)).filter((f) => f.seq > switchedAt).length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(10);
    const after = (await frames(page)).filter((f) => f.seq > switchedAt);
    // Every processed frame carries a hand result (empty here); face ran on even frames only.
    for (const f of after) expect(f.faceRan).toBe(f.seq % 2 === 0);
    // No frame was skipped for hands: sequence numbers of processed frames are consecutive.
    for (let i = 1; i < after.length; i++) expect(after[i]?.seq).toBe((after[i - 1]?.seq ?? 0) + 1);
  });
});
