import { expect, type Page, test } from "@playwright/test";
import { closeSettings, openSettings } from "./settings.ts";
import { frames, framesDuring, startCamera } from "./tracking.ts";

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
    const recent = await framesDuring(page, 3000);
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
    await openSettings(page, "camera");
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
    await openSettings(page, "camera");
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

test.describe("camera view", () => {
  test("floats at the model's bottom right and keeps running while the settings open and close", async ({
    page,
  }) => {
    await page.goto("/");
    await startCamera(page);
    const view = await page.getByTestId("camera-view").boundingBox();
    const stage = await page.locator(".stage").boundingBox();
    if (!view || !stage) throw new Error("not laid out");
    expect(view.x + view.width).toBeGreaterThan(stage.x + stage.width - 40);
    expect(view.y + view.height).toBeGreaterThan(stage.y + stage.height - 40);
    expect(view.width).toBeLessThan(stage.width / 3);
    await openSettings(page, "camera");
    await closeSettings(page);
    const before = (await frames(page)).length;
    await expect.poll(async () => (await frames(page)).length).toBeGreaterThan(before);
    await expect(page.getByTestId("camera-indicator")).toHaveAttribute("data-state", "on");
  });

  test("expands over the model, shrinks back, and is remembered after a reload", async ({ page }) => {
    await page.goto("/");
    await startCamera(page);
    const preview = page.getByTestId("camera-preview");
    const expand = page.getByTestId("preview-expand");
    const small = await preview.boundingBox();
    await expect(expand).toHaveAttribute("aria-pressed", "false");

    await expand.click();
    await expect(preview).toHaveAttribute("data-expanded", "true");
    await expect(expand).toHaveAttribute("aria-pressed", "true");
    const large = await preview.boundingBox();
    expect(large?.width).toBeGreaterThan((small?.width ?? 0) * 1.5);
    // It covers most of the model area, and the controls stay usable.
    const stage = await page.locator(".stage").boundingBox();
    expect(large?.height ?? 0).toBeGreaterThan((stage?.height ?? 0) * 0.6);
    await expect(page.getByTestId("camera-toggle")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("camera-preview")).toHaveAttribute("data-expanded", "true");
    await page.getByTestId("preview-expand").click();
    await expect(page.getByTestId("camera-preview")).toHaveAttribute("data-expanded", "false");
    await page.reload();
    await expect(page.getByTestId("camera-preview")).toHaveAttribute("data-expanded", "false");
  });

  test("tucks away into a pill and comes back, the camera still running", async ({ page }) => {
    await page.goto("/");
    await startCamera(page);
    await page.getByTestId("camera-minimise").click();
    await expect(page.getByTestId("camera-view")).toHaveCount(0);
    const before = (await frames(page)).length;
    await expect.poll(async () => (await frames(page)).length).toBeGreaterThan(before);
    await page.getByTestId("camera-restore").click();
    await expect(page.getByTestId("camera-view")).toBeVisible();
  });
});
