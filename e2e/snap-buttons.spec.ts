import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { handAt, now, openViewer, startTestBridge } from "./viewer.ts";

// A hand pointer near a button locks onto it, so a pinch presses it. Hand input is injected into the same bus the
// tracker feeds, with each hand's pinch point (and whether its fingers are closing).
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

type Point = [number, number];
const GEAR = '[data-testid="settings-button"]';

async function start(page: Page) {
  bridge = await startTestBridge(page);
  await openViewer(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
}

/** The pinch point (camera frame) whose pointer is `px` pixels to the left of a control's edge, level with it. */
async function pinchNear(page: Page, selector: string, px: number): Promise<Point> {
  const box = await page.locator(selector).first().boundingBox();
  const viewer = await page.getByTestId("viewer").boundingBox();
  if (!box || !viewer) throw new Error(`${selector} is not laid out`);
  const x = box.x - px;
  const y = box.y + box.height / 2;
  return handAt(page, [(x - viewer.x) / viewer.width, (y - viewer.y) / viewer.height]);
}

const pointer = (page: Page, right: Point | null, left: Point | null, closing?: { Left?: boolean }) =>
  page.evaluate(([r, l, c]) => window.__HAI_INPUT__?.pointer(r, l, c ?? undefined), [
    right,
    left,
    closing ?? null,
  ] as const);

async function tap(page: Page, hand: "Left" | "Right", position: Point) {
  const ts = await now(page);
  await page.evaluate(
    (e) => window.__HAI_INPUT__?.gestures([{ confidence: 1, delta: [0, 0], ...e } as never]),
    { type: "pinch.tap", hand, position, ts },
  );
}

const mode = (page: Page, hand: "left" | "right") =>
  page.getByTestId(`hand-pointer-${hand}`).getAttribute("data-mode");

async function centreOf(page: Page, selector: string): Promise<Point> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} is not laid out`);
  return [box.x + box.width / 2, box.y + box.height / 2];
}

/** Where a hand pointer is drawn on screen (the middle of its element), px. */
async function drawnAt(page: Page, hand: "left" | "right"): Promise<Point> {
  return centreOf(page, `[data-testid="hand-pointer-${hand}"]`);
}

test("a near miss presses the button: the pointer locks onto it, and a pinch presses it", async ({
  page,
}) => {
  await start(page);
  const near = await pinchNear(page, GEAR, 20);
  await pointer(page, null, near);
  await expect(page.getByTestId("hand-pointer-left")).toHaveAttribute("data-mode", "press");
  await expect(page.locator(GEAR)).toHaveAttribute("data-hand-hover", "left");
  // Drawn on the button, not where the hand is.
  const [px, py] = await drawnAt(page, "left");
  const [gx, gy] = await centreOf(page, GEAR);
  expect(Math.abs(px - gx)).toBeLessThanOrEqual(2);
  expect(Math.abs(py - gy)).toBeLessThanOrEqual(2);
  await tap(page, "Left", near);
  await expect(page.getByTestId("settings-panel")).toHaveAttribute("data-open", "true");
});

test("further than the capture distance does not lock, and letting go takes a bigger distance", async ({
  page,
}) => {
  await start(page);
  await pointer(page, null, await pinchNear(page, GEAR, 40));
  await expect(page.getByTestId("hand-pointer-left")).toBeVisible();
  expect(await mode(page, "left")).not.toBe("press");

  await pointer(page, null, await pinchNear(page, GEAR, 20)); // locks
  await expect(page.getByTestId("hand-pointer-left")).toHaveAttribute("data-mode", "press");
  await pointer(page, null, await pinchNear(page, GEAR, 35)); // 35 px: still locked
  await expect(page.getByTestId("hand-pointer-left")).toHaveAttribute("data-mode", "press");
  await pointer(page, null, await pinchNear(page, GEAR, 60)); // 60 px: free
  await expect(page.getByTestId("hand-pointer-left")).not.toHaveAttribute("data-mode", "press");
});

test("a pinch that began on a button keeps it when the hand drifts while the fingers close", async ({
  page,
}) => {
  await start(page);
  const near = await pinchNear(page, GEAR, 20);
  await pointer(page, null, near);
  await expect(page.getByTestId("hand-pointer-left")).toHaveAttribute("data-mode", "press");
  await pointer(page, null, await pinchNear(page, GEAR, 90), { Left: true }); // drifted 90 px, fingers closing
  await expect(page.getByTestId("hand-pointer-left")).toHaveAttribute("data-mode", "press");
  await tap(page, "Left", near); // the tap carries the position the pinch began at
  await expect(page.getByTestId("settings-panel")).toHaveAttribute("data-open", "true");
});

test("a pinch that began on the model does not lock onto a button it passes", async ({ page }) => {
  await start(page);
  await pointer(page, null, await pinchNear(page, GEAR, 300), { Left: true }); // closing, far from any button
  await pointer(page, null, await pinchNear(page, GEAR, 10), { Left: true }); // passes close to the gear
  expect(await mode(page, "left")).not.toBe("press");
  await expect(page.locator(GEAR)).not.toHaveAttribute("data-hand-hover", "left");
});

test("each hand snaps on its own", async ({ page }) => {
  await start(page);
  const right = await handAt(page, [0.6, 0.6]);
  await pointer(page, right, await pinchNear(page, GEAR, 20));
  await expect(page.getByTestId("hand-pointer-left")).toHaveAttribute("data-mode", "press");
  expect(await mode(page, "right")).not.toBe("press");
  await expect(page.locator(GEAR)).toHaveAttribute("data-hand-hover", "left");
});

test("with Snap to buttons off, the pointer is not pulled and a near miss presses nothing", async ({
  page,
}) => {
  await start(page);
  await openSettings(page, "features");
  await page.getByTestId("feature-snapToButtons").click();
  await expect(page.getByTestId("feature-snapToButtons")).toHaveAttribute("aria-checked", "false");
  await closeSettings(page);
  const near = await pinchNear(page, GEAR, 20);
  await pointer(page, null, near);
  await expect(page.getByTestId("hand-pointer-left")).toBeVisible();
  expect(await mode(page, "left")).not.toBe("press");
  await tap(page, "Left", near);
  await expect(page.getByTestId("settings-panel")).toHaveAttribute("data-open", "false");
});

test("the mouse is never snapped: a click beside a button presses nothing", async ({ page }) => {
  await start(page);
  const [gx, gy] = await centreOf(page, GEAR);
  const box = await page.locator(GEAR).boundingBox();
  await page.mouse.click(gx - (box?.width ?? 40) / 2 - 15, gy);
  await expect(page.getByTestId("settings-panel")).toHaveAttribute("data-open", "false");
});

test("snapping adds no gesture-to-render time: the orbit p90 is within a few milliseconds with it on or off", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await start(page);
  const right = await handAt(page, [0.55, 0.55]);
  /** Orbits for 40 frames with a pointer sample for each, and reads the status bar's gesture-to-render p90. */
  const orbitP90 = async () => {
    for (let i = 0; i < 40; i++) {
      await page.evaluate(
        ([i, right]) => {
          const ts = performance.timeOrigin + performance.now();
          const at: [number, number] = [right[0] + i * 0.002, right[1]];
          window.__HAI_INPUT__?.pointer(at, null);
          window.__HAI_INPUT__?.gestures([
            {
              type: i === 0 ? "pinch.drag.start" : "pinch.drag.update",
              ts,
              confidence: 1,
              hand: "Right",
              position: at,
              delta: [0.002, 0],
            } as never,
          ]);
        },
        [i, right] as const,
      );
      await page.waitForTimeout(33);
    }
    await page.evaluate(() =>
      window.__HAI_INPUT__?.gestures([
        {
          type: "pinch.drag.end",
          ts: performance.timeOrigin + performance.now(),
          confidence: 1,
          hand: "Right",
          position: [0.6, 0.55],
        } as never,
      ]),
    );
    return page.evaluate(() => window.__HAI_VIEWER__?.latencyP90() ?? 0);
  };
  const on = await orbitP90();
  await openSettings(page, "features");
  await page.getByTestId("feature-snapToButtons").click();
  await closeSettings(page);
  await page.waitForTimeout(3500); // the readout looks at the last 3 seconds
  const off = await orbitP90();
  console.log(
    `orbit gesture to render p90: ${on.toFixed(1)} ms with Snap to buttons on, ${off.toFixed(1)} ms off`,
  );
  expect(on).toBeLessThan(off + 8);
  expect(on).toBeLessThan(50);
});
