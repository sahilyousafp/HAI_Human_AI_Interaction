import { expect, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// The panels laid over the model (the project bar, what a tool says, the view cube, the section readout, the status bar
// and the camera view) share a model that is narrower beside the chat rail. None of them may sit over another, and the
// project bar's buttons keep their shape however narrow it gets.

let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1024, height: 640 },
  { width: 900, height: 600 },
];

/** Each tool brings its own panels over the model: the section its readout, the wall its constraints. */
const TOOLS: Array<{ key: string; panels: Record<string, string> }> = [
  { key: "s", panels: { "section readout": '[data-testid="section-status"]' } },
  { key: "w", panels: { constraints: ".constraints" } },
];

for (const size of SIZES) {
  for (const tool of TOOLS) {
    test(`nothing over the model covers anything else at ${size.width} px with the ${tool.key.toUpperCase()} tool`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      bridge = await startTestBridge(page);
      await openViewer(page);
      await page.keyboard.press(tool.key);
      await expect(page.getByTestId("tool-notice")).toBeVisible();
      const report = await page.evaluate((extra) => {
        const panels: Record<string, string> = {
          "project bar": ".viewer-toolbar",
          "tool notice": '[data-testid="tool-notice"]',
          "view cube": ".view-cube-box",
          "status bar": ".viewer-status",
          "camera view": ".camera-view",
          ...extra,
        };
        const boxes = Object.entries(panels).map(([name, selector]) => {
          const box = document.querySelector(selector)?.getBoundingClientRect();
          if (!box) throw new Error(`${name} is not on screen`);
          return { name, box };
        });
        const overlaps: string[] = [];
        for (const [i, a] of boxes.entries()) {
          for (const b of boxes.slice(i + 1)) {
            const across = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
            const down = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
            if (across > 0 && down > 0) overlaps.push(`${a.name} and ${b.name}`);
          }
        }
        // A button that was squeezed shows its label over two lines and grows tall.
        const buttons = [...document.querySelectorAll(".toolbar-buttons button")].map(
          (button) => button.getBoundingClientRect().height,
        );
        return { overlaps, tallest: Math.max(...buttons) };
      }, tool.panels);
      expect(report.overlaps).toEqual([]);
      expect(report.tallest).toBeLessThan(40);
    });
  }
}
