import { expect, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { findElementOnScreen, handAt, openViewer, startTestBridge } from "./viewer.ts";

// Dragging a hand across the model while speaking used to number every element it rested on. That is now an opt-in
// feature ("Number what I point at"); by default what the user means is what they selected.

let bridge: (Bridge & { port: number }) | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

/** What the recorder does when speech starts, without needing a microphone. */
const startSpeaking = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    window.__HAI_VOICE__?.context.begin(Date.now(), null);
    // While it listens the voice controller settles what the pointer rests on every 100 ms.
    setInterval(() => window.__HAI_VOICE__?.context.tick(Date.now()), 100);
  });

test("by default a hand resting on a model while speaking numbers nothing", async ({ page }) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  const wall = await findElementOnScreen(page, "wall-s");
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await startSpeaking(page);
  await page.evaluate((p) => window.__HAI_INPUT__?.pointer(p), await handAt(page, wall));
  await page.waitForTimeout(900); // well past the 300 ms a pointer must rest to be captured
  await expect(page.getByTestId("reference-marker")).toHaveCount(0);
});

test("a model selected while speaking is numbered", async ({ page }) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  await startSpeaking(page);
  await page.evaluate(() => window.__HAI_SCENE__?.select(["wall-s"]));
  const marker = page.getByTestId("reference-marker");
  await expect(marker).toHaveText("1");
  await expect(marker).toHaveAttribute("data-element", "wall-s");
});

test("with Number what I point at on, the model the hand rests on is numbered", async ({ page }) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  await openSettings(page, "features");
  await expect(page.getByTestId("feature-pointCapture")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("feature-pointCapture").click();
  await expect(page.getByTestId("feature-pointCapture")).toHaveAttribute("aria-checked", "true");
  await closeSettings(page);
  const wall = await findElementOnScreen(page, "wall-s");
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await startSpeaking(page);
  await page.evaluate((p) => window.__HAI_INPUT__?.pointer(p), await handAt(page, wall));
  const marker = page.getByTestId("reference-marker");
  await expect(marker).toHaveText("1");
  await expect(marker).toHaveAttribute("data-element", "wall-s");
});
