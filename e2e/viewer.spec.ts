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
    await page.evaluate((p) => window.__AEX_INPUT__?.pointer(p), await handAt(page, at));
    await expect(page.getByTestId("hand-pointer-right")).toBeVisible();
    const ts = await now(page);
    await page.evaluate(
      ({ position, ts }) =>
        window.__AEX_INPUT__?.gestures([{ type: "pinch.tap", ts, confidence: 1, hand: "Right", position }]),
      { position: await handAt(page, at), ts },
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
      { position: await handAt(page, empty as [number, number]), ts },
    );
    await expect(page.getByTestId("selection-status")).toHaveText("Nothing selected");
  });
  test("both hands are pointers, each in its own colour; not engaged, both still show, dimmed", async ({
    page,
  }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    const at = await findElementOnScreen(page, "block-b");
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
    // One hand: one pointer.
    await page.evaluate((p) => window.__AEX_INPUT__?.pointer(p), await handAt(page, at));
    await expect(page.getByTestId("hand-pointer-right")).toBeVisible();
    await expect(page.getByTestId("hand-pointer-left")).toHaveCount(0);
    // Both hands: two full pointers, in the colours the camera overlay draws each hand in.
    await page.evaluate(([p, q]) => window.__AEX_INPUT__?.pointer(p, q), [
      await handAt(page, at),
      await handAt(page, [0.15, 0.2]),
    ] as const);
    const left = page.getByTestId("hand-pointer-left");
    await expect(left).toBeVisible();
    await expect(left).toHaveAttribute("data-mode", "select");
    const colors = await page.evaluate(() => {
      const css = (id: string) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return el ? getComputedStyle(el).borderTopColor : null;
      };
      const hand = getComputedStyle(document.documentElement).getPropertyValue("--hand-left").trim();
      const probe = document.createElement("div");
      probe.style.color = hand;
      document.body.append(probe);
      const leftHand = getComputedStyle(probe).color;
      probe.remove();
      return { right: css("hand-pointer-right"), left: css("hand-pointer-left"), leftHand };
    });
    expect(colors.left).toBe(colors.leftHand);
    expect(colors.left).not.toBe(colors.right);
    // Hover in the model follows the right hand until the left one pinches.
    await expect(page.getByTestId("hand-pointer-right")).toHaveAttribute("data-focus", "true");
    // Not engaged: the pointers still show where the hands are, dimmed.
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(false));
    await page.evaluate(([p, q]) => window.__AEX_INPUT__?.pointer(p, q), [
      await handAt(page, at),
      await handAt(page, [0.15, 0.2]),
    ] as const);
    await expect(page.getByTestId("hand-pointer-right")).toHaveAttribute("data-engaged", "false");
    await expect(left).toHaveAttribute("data-engaged", "false");
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
    expect((await camera(page)).azimuth).toBeLessThan(before.azimuth); // drag right: negative azimuth
  });

  test("a flicked orbit coasts on after the release and then stops by itself", async ({ page }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    const ts = await now(page);
    await page.evaluate((ts) => {
      const e = (type: string, t: number, extra = {}) => ({
        type,
        ts: t,
        confidence: 1,
        hand: "Right",
        position: [0.5, 0.5],
        ...extra,
      });
      // Six quick moves 33 ms apart (a tracking frame each), released while still moving.
      const events = [e("pinch.drag.start", ts)];
      for (let i = 1; i <= 6; i++) events.push(e("pinch.drag.update", ts + i * 33, { delta: [0.03, 0] }));
      events.push(e("pinch.drag.end", ts + 7 * 33));
      window.__AEX_INPUT__?.gestures(events as never[]);
    }, ts);
    const released = (await camera(page)).azimuth;
    await page.waitForTimeout(300);
    const coasting = (await camera(page)).azimuth;
    expect(((coasting - released + 540) % 360) - 180).toBeLessThan(-5); // still turning the same way
    await page.waitForTimeout(2500);
    const settled = (await camera(page)).azimuth;
    await page.waitForTimeout(300);
    expect((await camera(page)).azimuth).toBe(settled); // stopped
  });

  test("turning both pinching hands like a dial turns the view", async ({ page }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    const before = await camera(page);
    const ts = await now(page);
    await page.evaluate((ts) => {
      const e = (type: string, t: number, angle: number) => ({
        type,
        ts: t,
        confidence: 1,
        hand: "both",
        distance: 0.3,
        midpoint: [0.5, 0.5],
        angle,
      });
      window.__AEX_INPUT__?.gestures([
        e("twohand.start", ts, 0),
        e("twohand.update", ts + 33, 10),
        e("twohand.update", ts + 66, 20),
        e("twohand.end", ts + 400, 20), // held still before letting go: no coast
      ] as never[]);
    }, ts);
    const after = await camera(page);
    expect(((after.azimuth - before.azimuth + 540) % 360) - 180).toBeCloseTo(20, 5);
    expect(after.distance).toBeCloseTo(before.distance, 5);
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
