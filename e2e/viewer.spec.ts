import { expect, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { attachPreview } from "./overlay.ts";
import { camera, findElementOnScreen, handAt, now, openViewer, startTestBridge } from "./viewer.ts";

let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

test.describe("viewer", () => {
  test("renders every element of the sample scene, Z up, with the model in view", async ({
    page,
  }, testInfo) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    const elements = Object.keys(bridge.scene.scene.doc.elements).length;
    expect(await page.evaluate(() => window.__AEX_VIEWER__?.meshCount())).toBe(elements);
    // Something solid is under the middle of the view, and the camera looks down from above (Z up).
    await findElementOnScreen(page, "block-b");
    expect((await camera(page)).elevation).toBeGreaterThan(0);
    await testInfo.attach("viewer", {
      body: await page.locator("[data-testid=viewer]").screenshot(),
      contentType: "image/png",
    });
  });

  test("mouse works with tracking on: dragging orbits the view", async ({ page }, testInfo) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    await page.getByTestId("camera-toggle").click();
    await expect(page.getByTestId("camera-indicator")).toHaveAttribute("data-state", "on");
    const before = await camera(page);
    const box = await page.locator("[data-testid=viewer] canvas").boundingBox();
    if (!box) throw new Error("no canvas");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    expect((await camera(page)).azimuth).not.toBeCloseTo(before.azimuth, 1);
    await attachPreview(page, testInfo, "tracking-on");
  });

  test("keyboard undo and redo revert and reapply an edit", async ({ page }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    const count = () => page.evaluate(() => window.__AEX_VIEWER__?.meshCount());
    const initial = await count();
    await page.evaluate(() => window.__AEX_SCENE__?.apply("Delete tower", [{ op: "delete", id: "block-b" }]));
    await expect.poll(count).toBe((initial ?? 0) - 1);
    await page.locator("[data-testid=viewer] canvas").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(count).toBe(initial);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(count).toBe((initial ?? 0) - 1);
  });
  test("an idle view stops rendering, and moving the camera renders until it has eased into place", async ({
    page,
  }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    const renders = () => page.evaluate(() => window.__AEX_VIEWER__?.renders() ?? 0);
    // Let the first framing settle, then nothing should draw for a second.
    await page.waitForTimeout(1500);
    const idleStart = await renders();
    await page.waitForTimeout(1000);
    expect((await renders()) - idleStart).toBeLessThanOrEqual(1);
    // A drag renders frames while the camera eases, then stops again.
    const box = await page.getByTestId("viewer").boundingBox();
    if (!box) throw new Error("viewer not laid out");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    const afterDrag = await renders();
    expect(afterDrag - idleStart).toBeGreaterThan(3);
    await page.waitForTimeout(1500);
    const settled = await renders();
    await page.waitForTimeout(1000);
    expect((await renders()) - settled).toBeLessThanOrEqual(1);
  });
});

test.describe("hand pointer and selection", () => {
  test("tap selects the hovered element", async ({ page }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    const at = await findElementOnScreen(page, "block-b");
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
    await page.evaluate((p) => window.__AEX_INPUT__?.pointer(p), handAt(at));
    await expect(page.getByTestId("hand-pointer")).toBeVisible();
    const ts = await now(page);
    await page.evaluate(
      ({ position, ts }) =>
        window.__AEX_INPUT__?.gestures([{ type: "pinch.tap", ts, confidence: 1, hand: "Right", position }]),
      { position: handAt(at), ts },
    );
    await expect(page.getByTestId("selection-status")).toHaveText("Block B tower (massing)");
    await expect.poll(() => bridge?.scene.scene.selection).toEqual(["block-b"]);
  });

  test("tap on empty space clears the selection", async ({ page }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    await page.evaluate(() => window.__AEX_SCENE__?.select(["wall-n"]));
    await expect(page.getByTestId("selection-status")).toContainText("North wall");
    const empty = await page.evaluate(() => {
      for (let y = 0.05; y < 0.5; y += 0.05)
        for (let x = 0.05; x < 1; x += 0.05) if (!window.__AEX_VIEWER__?.pick(x, y)) return [x, y];
      return null;
    });
    if (!empty) throw new Error("no empty sky found");
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
    const ts = await now(page);
    await page.evaluate(
      ({ position, ts }) =>
        window.__AEX_INPUT__?.gestures([{ type: "pinch.tap", ts, confidence: 1, hand: "Right", position }]),
      { position: handAt(empty as [number, number]), ts },
    );
    await expect(page.getByTestId("selection-status")).toHaveText("Nothing selected");
  });
  test("with both hands visible the left hand gets a second, grey pointer; hover stays with the right", async ({
    page,
  }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    const at = await findElementOnScreen(page, "block-b");
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
    // One hand: one pointer.
    await page.evaluate((p) => window.__AEX_INPUT__?.pointer(p), handAt(at));
    await expect(page.getByTestId("hand-pointer")).toBeVisible();
    await expect(page.getByTestId("hand-pointer-secondary")).toHaveCount(0);
    // Both hands: the left one shows in light grey, away from the right one.
    await page.evaluate(([p, q]) => window.__AEX_INPUT__?.pointer(p, q), [
      handAt(at),
      handAt([0.15, 0.2]),
    ] as const);
    const secondary = page.getByTestId("hand-pointer-secondary");
    await expect(secondary).toBeVisible();
    const colors = await page.evaluate(() => {
      const css = (id: string) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return el ? getComputedStyle(el).borderTopColor : null;
      };
      return { primary: css("hand-pointer"), secondary: css("hand-pointer-secondary") };
    });
    expect(colors.secondary).not.toBe(colors.primary);
    // Not engaged: no pointers.
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(false));
    await expect(page.getByTestId("hand-pointer")).toHaveCount(0);
    await expect(secondary).toHaveCount(0);
  });
});

test.describe("navigation", () => {
  test("navigation while the bridge is down: hand drags still orbit", async ({ page }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    await bridge.stop();
    bridge = null;
    await expect(page.getByTestId("bridge-status")).toHaveAttribute("data-state", "offline");
    const before = await camera(page);
    const ts = await now(page);
    await page.evaluate((ts) => {
      const e = (type: string, extra = {}) => ({
        type,
        ts,
        confidence: 1,
        hand: "Right",
        position: [0.5, 0.5],
        ...extra,
      });
      window.__AEX_INPUT__?.gestures([
        e("pinch.drag.start") as never,
        e("pinch.drag.update", { delta: [0.1, 0] }) as never,
        e("pinch.drag.end") as never,
      ]);
    }, ts);
    expect((await camera(page)).azimuth).toBeGreaterThan(before.azimuth);
  });

  test("gesture-to-render latency is measured and shown", async ({ page }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    for (let i = 0; i < 5; i++) {
      const ts = await now(page);
      await page.evaluate((ts) => {
        window.__AEX_INPUT__?.gestures([
          {
            type: "pinch.drag.update",
            ts,
            confidence: 1,
            hand: "Right",
            position: [0.5, 0.5],
            delta: [0.01, 0],
          },
        ]);
      }, ts);
      await page.waitForTimeout(50);
    }
    await expect(page.getByTestId("hud-latency")).toHaveText(/Gesture to render p90: \d+ ms/);
    expect(await page.evaluate(() => window.__AEX_VIEWER__?.latencyP90())).toBeGreaterThan(0);
  });
});
