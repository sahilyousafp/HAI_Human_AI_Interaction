import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../../apps/bridge/src/server.ts";
import { closeSettings, openSettings } from "../settings.ts";
import { handAt, openViewer, startTestBridge } from "../viewer.ts";

// Screenshots of the precision work: the Drawing aids page, a pointer locked onto a button, a snap marker, the
// import report and the message shown while a file is dragged over the model.
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

const MODEL = join(import.meta.dirname, "..", "..", "test-assets", "models", "layers-and-colours.3dm");

for (const scheme of ["light", "dark"] as const) {
  test(`settings, Drawing aids page (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    bridge = await startTestBridge(page);
    await openViewer(page);
    await openSettings(page, "drawing-aids");
    await page.getByTestId("aid-endpoint").click(); // one more on, to show both states
    await page.waitForTimeout(500); // the sheet and the switch settle
    await expect(page.getByTestId("settings-panel")).toHaveScreenshot(`settings-drawing-aids-${scheme}.png`);
  });

  test(`a pointer locked onto the settings button (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    bridge = await startTestBridge(page);
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    const gear = await page.getByTestId("settings-button").boundingBox();
    const viewer = await page.getByTestId("viewer").boundingBox();
    if (!gear || !viewer) throw new Error("not laid out");
    // 22 px to the left of the button, level with it: close enough to lock.
    const hand = await handAt(page, [
      (gear.x - 22 - viewer.x) / viewer.width,
      (gear.y + gear.height / 2 - viewer.y) / viewer.height,
    ]);
    await page.evaluate((h) => window.__HAI_INPUT__?.pointer(null, h), hand);
    await expect(page.getByTestId("hand-pointer-left")).toHaveAttribute("data-mode", "press");
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot(`snapped-pointer-${scheme}.png`, {
      clip: { x: Math.max(0, gear.x - 120), y: 0, width: 240, height: 90 },
    });
  });
}

/** A wall end of the sample project that is clear on screen, and where. */
async function clearWallEnd(page: Page): Promise<[number, number]> {
  const walls = Object.values(bridge?.scene.scene.doc.elements ?? {}).filter((e) => e.type === "wall");
  for (const wall of walls) {
    for (const end of [wall.start, wall.end]) {
      const at = await page.evaluate(
        ([x, y]) => {
          const canvas = document.querySelector("[data-testid=viewer] canvas");
          const rect = canvas?.getBoundingClientRect();
          const p = window.__HAI_VIEWER__?.project([x, y, 0]);
          if (!rect || !p) return null;
          const px = rect.left + p[0] * rect.width;
          const py = rect.top + p[1] * rect.height;
          const clear = [
            [0, 0],
            [90, 0],
            [-90, 0],
            [0, 60],
            [0, -60],
          ].every(([dx = 0, dy = 0]) => document.elementFromPoint(px + dx, py + dy) === canvas);
          return clear ? [px, py] : null;
        },
        end as [number, number],
      );
      if (at) return at as [number, number];
    }
  }
  throw new Error("no wall end is clear on screen");
}

test("the Endpoint marker with its name", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  bridge = await startTestBridge(page);
  await openViewer(page);
  await openSettings(page, "drawing-aids");
  await page.getByTestId("aid-endpoint").click();
  await closeSettings(page);
  const [x, y] = await clearWallEnd(page);
  await page.keyboard.press("w");
  await page.mouse.move(x + 8, y + 5);
  await expect(page.getByTestId("snap-label")).toHaveText("Endpoint");
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("snap-marker-endpoint.png", {
    clip: { x: Math.max(0, x - 70), y: Math.max(0, y - 50), width: 170, height: 110 },
  });
});

test("the import report after a model is dropped in", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  bridge = await startTestBridge(page);
  await openViewer(page);
  await page.getByTestId("import-input").setInputFiles(MODEL);
  await expect(page.getByTestId("import-summary")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await expect(page.getByTestId("import-report")).toHaveScreenshot("import-report.png");
});

test("the message shown while a file is dragged over the model", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  bridge = await startTestBridge(page);
  await openViewer(page);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "model.3dm"));
    document
      .querySelector("[data-testid=viewer]")
      ?.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId("import-drop")).toBeVisible();
  await expect(page.getByTestId("viewer")).toHaveScreenshot("import-drop.png");
});

test("the Endpoint marker on the top corner of an imported building", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  bridge = await startTestBridge(page);
  await openViewer(page);
  const dir = join(mkdtempSync(join(tmpdir(), "hai-visual-")), "fresh");
  await page.getByTestId("new-project").click();
  await page.getByTestId("project-path").fill(dir);
  await page.getByTestId("project-submit").click();
  await expect(page.getByTestId("project-status")).toContainText("fresh", { timeout: 15_000 });
  await page
    .getByTestId("import-input")
    .setInputFiles(join(import.meta.dirname, "..", "..", "test-assets", "models", "meshes-and-breps.3dm"));
  await expect(page.getByTestId("import-summary")).toBeVisible({ timeout: 30_000 });
  await openSettings(page, "drawing-aids");
  await page.getByTestId("aid-endpoint").click();
  await closeSettings(page);
  await page.getByTestId("import-close").click();
  // The top corner (8000, 2000, 3000) of the third box, where it appears on screen.
  const top = await page.evaluate(() => {
    const rect = document.querySelector("[data-testid=viewer] canvas")?.getBoundingClientRect();
    const at = window.__HAI_VIEWER__?.project([8000, 2000, 3000]);
    return rect && at ? [rect.left + at[0] * rect.width, rect.top + at[1] * rect.height] : null;
  });
  if (!top) throw new Error("the corner is not in view");
  await page.keyboard.press("w");
  await page.mouse.move((top[0] as number) + 8, (top[1] as number) + 5);
  await expect(page.getByTestId("snap-label")).toHaveText("Endpoint");
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("snap-marker-top-corner.png", {
    clip: {
      x: Math.max(0, (top[0] as number) - 90),
      y: Math.max(0, (top[1] as number) - 70),
      width: 200,
      height: 140,
    },
  });
});
