import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../../apps/bridge/src/server.ts";
import { openViewer, startTestBridge } from "../viewer.ts";

let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

/** Waits until the view has stopped drawing (the camera eased into place), so screenshots are stable. */
async function settled(page: Page) {
  const renders = () => page.evaluate(() => window.__AEX_VIEWER__?.renders() ?? 0);
  let last = -1;
  await expect
    .poll(
      async () => {
        const now = await renders();
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [300] },
    )
    .toBe(true);
}

for (const scheme of ["light", "dark"] as const) {
  test(`open palette (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    bridge = await startTestBridge(page);
    await openViewer(page);
    await settled(page);
    const box = await page.getByTestId("viewer").boundingBox();
    if (!box) throw new Error("viewer not laid out");
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await page.keyboard.down(" ");
    await page.mouse.move(box.x + box.width * 0.45 + 80, box.y + box.height * 0.5 + 2, { steps: 3 });
    const palette = page.getByTestId("tool-palette");
    await expect(page.getByTestId("palette-slot-2")).toHaveAttribute("data-highlighted", "true");
    await expect(palette).toHaveScreenshot(`palette-${scheme}.png`);
    await page.keyboard.up(" ");
  });
}

test("lowered section", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  bridge = await startTestBridge(page);
  await openViewer(page);
  await settled(page);
  await page.keyboard.press("s");
  const box = await page.getByTestId("viewer").boundingBox();
  if (!box) throw new Error("viewer not laid out");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId("section-status")).toContainText("mm");
  await page.mouse.move(box.x + 4, box.y + box.height - 4); // out of the way
  await settled(page);
  await expect(page.getByTestId("viewer")).toHaveScreenshot("section-lowered.png");
});

test("reference markers: two elements captured while speaking show markers 1 and 2", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  bridge = await startTestBridge(page);
  await openViewer(page);
  await settled(page);
  // What point-and-speak records: the pointer rests on a column, then on a wall, each for 400 ms.
  await page.evaluate(() => {
    const context = window.__AEX_VOICE__?.context;
    context?.begin(0, null);
    context?.hover("col-b2", 0);
    context?.hover("wall-s", 400);
    context?.hover(null, 800);
    context?.end(1000);
  });
  await expect(page.getByTestId("reference-marker")).toHaveCount(2);
  await settled(page);
  await expect(page.getByTestId("viewer")).toHaveScreenshot("reference-markers.png");
});
