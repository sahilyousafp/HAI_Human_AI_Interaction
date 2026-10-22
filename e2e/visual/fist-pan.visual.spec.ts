import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../../apps/bridge/src/server.ts";
import { handAt, now, openViewer, startTestBridge } from "../viewer.ts";

// Screenshots of the pan pointer: the four arrows on a closed hand, and filled in while the view moves, for each
// hand and both colour schemes.
// The crops are 80 px square, so the project's 2% tolerance would let a changed icon through: this spec allows 0.3%.
const TIGHT = { maxDiffPixelRatio: 0.003 };
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

type Hand = "Left" | "Right";

async function send(page: Page, type: string, hand: Hand, position: [number, number], delta = [0, 0]) {
  const ts = await now(page);
  await page.evaluate((e) => window.__AEX_INPUT__?.gestures([{ confidence: 1, ...e } as never]), {
    type,
    hand,
    position,
    delta,
    ts,
  });
}

for (const scheme of ["light", "dark"] as const) {
  for (const hand of ["Left", "Right"] as const) {
    test(`the pan pointer, ${hand.toLowerCase()} hand (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      bridge = await startTestBridge(page);
      await openViewer(page);
      await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
      const at = await handAt(page, [0.6, 0.6]);
      await page.evaluate(
        ([h, side]) =>
          side === "Left" ? window.__AEX_INPUT__?.pointer(null, h) : window.__AEX_INPUT__?.pointer(h),
        [at, hand] as const,
      );
      const pointer = page.getByTestId(`hand-pointer-${hand.toLowerCase()}`);
      const clipOf = async () => {
        const box = await pointer.boundingBox();
        if (!box) throw new Error("no pointer");
        const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
        return { x: Math.round(cx - 40), y: Math.round(cy - 40), width: 80, height: 80 };
      };
      await send(page, "clutch.start", hand, [0.4, 0.5]);
      await expect(pointer).toHaveAttribute("data-mode", "pan");
      await page.waitForTimeout(300); // the pointer settles
      await expect(page).toHaveScreenshot(`pan-pointer-closed-${hand.toLowerCase()}-${scheme}.png`, {
        clip: await clipOf(),
        ...TIGHT,
      });
      await send(page, "fist.drag.start", hand, [0.4, 0.5]);
      await send(page, "fist.drag.update", hand, [0.43, 0.5], [0.03, 0]);
      await expect(pointer).toHaveAttribute("data-panning", "true");
      await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`pan-pointer-panning-${hand.toLowerCase()}-${scheme}.png`, {
        clip: await clipOf(),
        ...TIGHT,
      });
    });
  }
}
