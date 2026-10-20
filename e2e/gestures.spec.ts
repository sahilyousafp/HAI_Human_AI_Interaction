import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { findElementOnScreen, handAt, now, openViewer, startTestBridge } from "./viewer.ts";

let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

const card = (page: Page) => page.getByTestId("gesture-settings");
const tapAt = async (page: Page, at: [number, number]) => {
  const ts = await now(page);
  await page.evaluate(
    ({ position, ts }) =>
      window.__AEX_INPUT__?.gestures([{ type: "pinch.tap", ts, confidence: 1, hand: "Right", position }]),
    { position: handAt(at), ts },
  );
};

test.describe("gesture settings", () => {
  test("lists every gesture with what it does, each with its own choices", async ({ page }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    const settings = card(page);
    await expect(settings.locator(".gesture-row")).toHaveCount(9); // open palm (fixed) and eight settable gestures
    await expect(settings.locator('[data-slot="engage"]')).toContainText("Engage (always)");
    await expect(settings.getByTestId("gesture-tap")).toHaveValue("use-tool");
    await expect(settings.getByLabel("Pinch tap")).toBeVisible();
    // A drag offers only what a drag can do.
    const dragChoices = await settings.getByTestId("gesture-drag").locator("option").allTextContents();
    expect(dragChoices).toEqual([
      "Active tool, else orbit (default)",
      "Orbit the view",
      "Pan the view",
      "Nothing",
    ]);
  });

  test("a detected gesture lights its row", async ({ page }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
    await tapAt(page, [0.9, 0.2]);
    await expect(card(page).locator('[data-slot="tap"]')).toHaveAttribute("data-lit", "true");
    await expect(card(page).locator('[data-slot="tap"]')).toHaveAttribute("data-lit", "false", {
      timeout: 3000,
    });
  });

  test("tap set to select picks a block whatever the tool, and the choice survives a reload", async ({
    page,
  }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    await card(page).getByTestId("gesture-tap").selectOption("select");
    await page.reload();
    await openViewer(page);
    await expect(card(page).getByTestId("gesture-tap")).toHaveValue("select");

    await page.keyboard.press("d"); // Measure: a tap would normally place a measuring point
    const at = await findElementOnScreen(page, "block-b");
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
    await tapAt(page, at);
    await expect(page.getByTestId("selection-status")).toHaveText("Block B tower (massing)");
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "measure");

    await card(page).getByRole("button", { name: "Reset to defaults" }).click();
    await expect(card(page).getByTestId("gesture-tap")).toHaveValue("use-tool");
  });

  test("fist set to undo undoes the last change once the fist is held", async ({ page }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    await card(page).getByTestId("gesture-fist").selectOption("undo");
    await page.evaluate(() =>
      window.__AEX_SCENE__?.apply("Move Block B", [
        { op: "update", id: "block-b", patch: { origin: [0, 0, 0] } },
      ]),
    );
    await expect.poll(() => bridge?.scene.scene.doc.elements["block-b"]).toMatchObject({ origin: [0, 0, 0] });
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
    await page.evaluate(() =>
      window.__AEX_INPUT__?.gestures([
        { type: "clutch.start", ts: Date.now(), confidence: 1, hand: "Right" },
      ]),
    );
    await expect
      .poll(() => bridge?.scene.scene.doc.elements["block-b"])
      .not.toMatchObject({ origin: [0, 0, 0] });
  });
});

test("select a block by hand with the default settings", async ({ page }) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  const at = await findElementOnScreen(page, "block-c");
  await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
  await page.evaluate((p) => window.__AEX_INPUT__?.pointer(p), handAt(at));
  await tapAt(page, at);
  await expect(page.getByTestId("selection-status")).toContainText("(massing)");
  await expect.poll(() => bridge?.scene.scene.selection).toEqual(["block-c"]);
});
