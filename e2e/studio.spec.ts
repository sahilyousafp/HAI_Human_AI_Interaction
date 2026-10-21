import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { handAt, openViewer, startTestBridge } from "./viewer.ts";

// The studio layout: the settings sheet, the feature switches, the floating camera view and Show my hands.
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

async function start(page: Page) {
  bridge = await startTestBridge(page);
  await openViewer(page);
}

test("the settings slide in from the right and close with the close button, Escape or Ctrl+,", async ({
  page,
}) => {
  await start(page);
  const panel = page.getByTestId("settings-panel");
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect(panel).not.toBeVisible();
  await page.getByTestId("settings-button").click();
  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(panel).toBeVisible();
  // Once it has slid in, it sits against the right edge.
  const viewport = page.viewportSize();
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return Math.round((box?.x ?? 0) + (box?.width ?? 0));
    })
    .toBe(viewport?.width ?? 0);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveAttribute("data-open", "false");
  await page.keyboard.press("Control+,");
  await expect(panel).toHaveAttribute("data-open", "true");
  await page.keyboard.press("Control+,");
  await expect(panel).toHaveAttribute("data-open", "false");
  // Every section opens its own page, with a way back.
  await openSettings(page, "features");
  await page.getByTestId("settings-back").click();
  await expect(page.getByTestId("settings-root")).toBeVisible();
});

test("switching Create tools off removes them everywhere, and the choice survives a reload", async ({
  page,
}) => {
  await start(page);
  await openSettings(page, "features");
  await page.getByTestId("feature-createTools").click();
  await expect(page.getByTestId("feature-createTools")).toHaveAttribute("aria-checked", "false");
  await closeSettings(page);
  await page.keyboard.press("w"); // Wall's shortcut
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "select");
  // The left hand's long pinch opens no ring without the create tools.
  await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
  const centre = await handAt(page, [0.6, 0.5]);
  const send = (type: string) =>
    page.evaluate(
      (e) => window.__AEX_INPUT__?.gestures([{ confidence: 1, delta: [0, 0], hand: "Left", ...e } as never]),
      { type, position: centre, ts: Date.now() },
    );
  await send("pinch.drag.start");
  await send("pinch.hold");
  await expect(page.getByTestId("tool-palette")).toHaveCount(0);
  await send("pinch.drag.end");

  await page.waitForTimeout(300); // the bridge writes .aex/settings.json
  await page.reload();
  await openViewer(page);
  await page.keyboard.press("w");
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "select");
  await openSettings(page, "features");
  await page.getByTestId("feature-createTools").click();
  await closeSettings(page);
  await page.keyboard.press("w");
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "wall");
});

test("switching the agent off takes the agent panel away", async ({ page }) => {
  await start(page);
  await expect(page.getByTestId("agent-panel")).toBeVisible();
  await openSettings(page, "features");
  await page.getByTestId("feature-agent").click();
  await expect(page.getByTestId("agent-panel")).toHaveCount(0);
  await page.getByTestId("feature-agent").click();
  await expect(page.getByTestId("agent-panel")).toBeVisible();
});

test("Show my hands draws a white hand at its pointer, and input still goes through it", async ({ page }) => {
  await start(page);
  await openSettings(page);
  await page.getByTestId("show-hands").click();
  await expect(page.getByTestId("show-hands")).toHaveAttribute("aria-checked", "true");
  await closeSettings(page);
  const overlay = page.getByTestId("hand-overlay");
  await expect(overlay).toBeAttached();
  // A right hand, open, its thumb and index tips meeting at the middle of the camera image.
  await page.evaluate(() => {
    const image = Array.from({ length: 21 }, (_, i) => {
      const finger = i === 0 ? -1 : Math.floor((i - 1) / 4);
      const joint = i === 0 ? 0 : (i - 1) % 4;
      return [i === 0 ? 0.5 : 0.42 + finger * 0.04, i === 0 ? 0.75 : 0.62 - joint * 0.05, 0];
    });
    image[4] = [0.5, 0.5, 0];
    image[8] = [0.5, 0.5, 0];
    const camera = window.__AEX_CAMERA__;
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
  // The pinch point at the middle of the image puts the hand at the middle of the window.
  const opaque = async (x: number, y: number) =>
    overlay.evaluate(
      (canvas, [px, py]) => {
        const c = canvas as HTMLCanvasElement;
        const scale = c.width / innerWidth;
        const ctx = c.getContext("2d");
        return ctx?.getImageData(Math.round(px * scale), Math.round(py * scale), 1, 1).data[3] ?? 0;
      },
      [x, y] as const,
    );
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const centre: [number, number] = [viewport.width / 2, viewport.height / 2];
  await expect.poll(() => opaque(centre[0], centre[1] + 20)).toBeGreaterThan(15); // a faint hand: about 10% opaque
  expect(await opaque(20, viewport.height - 20)).toBe(0); // only the hand is drawn
  // The overlay never takes input: what is under it is still what the pointer reaches.
  const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? "", centre);
  expect(under).not.toContain("hand-overlay");
  // Off again: nothing is drawn.
  await openSettings(page);
  await page.getByTestId("show-hands").click();
  await expect(overlay).toHaveCount(0);
});
