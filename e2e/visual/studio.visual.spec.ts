import { expect, test } from "@playwright/test";
import type { Bridge } from "../../apps/bridge/src/server.ts";
import { openSettings } from "../settings.ts";
import { openViewer, startTestBridge } from "../viewer.ts";

let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

for (const scheme of ["light", "dark"] as const) {
  test(`settings, first page (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    bridge = await startTestBridge(page);
    await openViewer(page);
    await openSettings(page);
    const panel = page.getByTestId("settings-panel");
    // Settled against the right edge.
    const width = page.viewportSize()?.width ?? 0;
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return Math.round((box?.x ?? 0) + (box?.width ?? 0));
      })
      .toBe(width);
    await expect(panel).toHaveScreenshot(`settings-${scheme}.png`);
  });
}

test("settings, Features page", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  bridge = await startTestBridge(page);
  await openViewer(page);
  await openSettings(page, "features");
  await page.getByTestId("feature-createTools").click(); // one switch off, to show both states
  await page.waitForTimeout(500); // the sheet and the switch settle
  await expect(page.getByTestId("settings-panel")).toHaveScreenshot("settings-features.png");
});

test("camera view, camera off", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  bridge = await startTestBridge(page);
  await openViewer(page);
  await expect(page.getByTestId("camera-view")).toHaveScreenshot("camera-view.png");
});

test("show my hands: a white hand over the interface", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  bridge = await startTestBridge(page);
  await openViewer(page);
  await openSettings(page);
  await page.getByTestId("show-hands").click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    // An open right hand, fingers spread, its pinch point a little left of the image centre.
    const image: number[][] = [[0.52, 0.78, 0]];
    const fingers = [
      [0.6, 0.66],
      [0.56, 0.5],
      [0.52, 0.47],
      [0.48, 0.5],
      [0.44, 0.56],
    ];
    for (const [f, [tx, ty]] of fingers.entries()) {
      const [bx, by] = f === 0 ? [0.58, 0.72] : [0.5 + (2 - f) * 0.025, 0.62];
      for (let j = 1; j <= 4; j++) {
        const t = j / 4;
        image.push([bx + ((tx as number) - bx) * t, by + ((ty as number) - by) * t, -0.02 * j]);
      }
    }
    image[4] = [0.55, 0.5, -0.05];
    image[8] = [0.55, 0.5, -0.05];
    const camera = window.__HAI_CAMERA__;
    if (camera) {
      camera.latestFrame = {
        seq: 1,
        captureTs: Date.now(),
        inferenceDoneTs: Date.now(),
        backend: "CPU",
        aspect: 4 / 3,
        hands: [{ handedness: "Right", score: 1, image, world: image.map(() => [0, 0, 0]) }],
      };
    }
  });
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("show-my-hands.png");
});
