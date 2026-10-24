import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { handAt, now, openViewer, startTestBridge } from "./viewer.ts";

// A hand's pinch is rarely pixel-exact: near a model it selects that model, and lights it up before the pinch.

let bridge: (Bridge & { port: number }) | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

/**
 * Viewer positions found by looking at what the viewer would hit, in pixels so the distances mean the same in every
 * direction: one that misses every element by `gapPx` (next to a model), and one that is at least `farPx` from all.
 */
async function find(page: Page, kind: { near: number } | { far: number }): Promise<[number, number]> {
  const spot = await page.evaluate((k) => {
    const viewer = window.__HAI_VIEWER__;
    const rect = document.querySelector("[data-testid=viewer] canvas")?.getBoundingClientRect();
    if (!viewer || !rect) return null;
    const free = (px: number, py: number) =>
      px > 0 &&
      py > 0 &&
      px < rect.width &&
      py < rect.height &&
      document.elementFromPoint(rect.left + px, rect.top + py)?.tagName === "CANVAS";
    const hits = (px: number, py: number) => viewer.pick(px / rect.width, py / rect.height) !== null;
    const around = (px: number, py: number, radius: number) => {
      for (let a = 0; a < 32; a++) {
        const x = px + radius * Math.cos((a * Math.PI) / 16);
        const y = py + radius * Math.sin((a * Math.PI) / 16);
        if (free(x, y) && hits(x, y)) return true;
      }
      return false;
    };
    // The middle and right of the view: away from the panels at its left and the controls, which a pointer snaps to.
    for (let py = 20; py < rect.height / 2; py += 12) {
      for (let px = rect.width * 0.7; px < rect.width - 20; px += 12) {
        if (!free(px, py) || hits(px, py)) continue;
        if ("near" in k) {
          if (around(px, py, k.near) && !around(px, py, k.near / 2))
            return [px / rect.width, py / rect.height];
        } else if (
          !Array.from({ length: k.far / 10 }, (_, i) => (i + 1) * 10).some((r) => around(px, py, r))
        ) {
          return [px / rect.width, py / rect.height];
        }
      }
    }
    return null;
  }, kind);
  if (!spot) throw new Error(`no spot found for ${JSON.stringify(kind)}`);
  return spot as [number, number];
}

const justOutside = (page: Page) => find(page, { near: 20 });
const farFromEverything = (page: Page) => find(page, { far: 80 });

async function pinchTapAt(page: Page, at: [number, number]) {
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await page.evaluate((p) => window.__HAI_INPUT__?.pointer(p), await handAt(page, at));
  const ts = await now(page);
  await page.evaluate(
    ({ position, ts }) =>
      window.__HAI_INPUT__?.gestures([{ type: "pinch.tap", ts, confidence: 1, hand: "Right", position }]),
    { position: await handAt(page, at), ts },
  );
}

test("a pinch just beside a model selects it", async ({ page }) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  const beside = await justOutside(page);
  expect(await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x, y), beside)).toBeNull();
  await pinchTapAt(page, beside);
  await expect.poll(() => bridge?.scene.scene.selection.length).toBe(1);
});

test("the model lights up before the pinch, so you see what it will select", async ({ page }) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  const beside = await justOutside(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await page.evaluate((p) => window.__HAI_INPUT__?.pointer(p), await handAt(page, beside));
  await expect.poll(() => page.evaluate(() => window.__HAI_VIEWER__?.hovered?.() ?? null)).not.toBeNull();
});

test("far from every model a pinch still selects nothing", async ({ page }) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  await page.evaluate(() => window.__HAI_SCENE__?.select(["wall-n"]));
  await expect(page.getByTestId("selection-status")).toContainText("North wall");
  await pinchTapAt(page, await farFromEverything(page));
  await expect(page.getByTestId("selection-status")).toHaveText("Nothing selected");
});

test("with Snap to models off, the same pinch beside a model selects nothing", async ({ page }) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  const beside = await justOutside(page);
  await openSettings(page, "features");
  await page.getByTestId("feature-snapToModels").click();
  await expect(page.getByTestId("feature-snapToModels")).toHaveAttribute("aria-checked", "false");
  await closeSettings(page);
  await pinchTapAt(page, beside);
  await expect(page.getByTestId("selection-status")).toHaveText("Nothing selected");
});

test("the mouse stays exact: a click beside a model selects nothing", async ({ page }) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  const beside = await justOutside(page);
  const canvas = await page.locator("[data-testid=viewer] canvas").boundingBox();
  if (!canvas) throw new Error("the viewer is not laid out");
  await page.mouse.click(canvas.x + beside[0] * canvas.width, canvas.y + beside[1] * canvas.height);
  await expect(page.getByTestId("selection-status")).toHaveText("Nothing selected");
});
