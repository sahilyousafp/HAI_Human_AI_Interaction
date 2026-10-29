import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { camera, findElementOnScreen, handAt, now, openViewer, startTestBridge } from "./viewer.ts";

// Tools act on the scene, so every test runs against its own bridge and throwaway project.
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

type Mm = [number, number, number];
const tools = (page: Page) =>
  page.evaluate(() => {
    const s = window.__HAI_TOOLS__?.getSnapshot();
    if (!s) throw new Error("tools not ready");
    return s;
  });
const element = (page: Page, id: string) =>
  page.evaluate((id) => window.__HAI_SCENE__?.getSnapshot().doc?.elements[id] ?? null, id);
const activeTool = (page: Page) => page.getByTestId("active-tool");

async function viewerBox(page: Page) {
  const box = await page.getByTestId("viewer").boundingBox();
  if (!box) throw new Error("viewer not laid out");
  return box;
}

/** Page position of a scene point in millimetres. */
async function screenOf(page: Page, point: Mm): Promise<{ x: number; y: number; inView: boolean }> {
  const [vx, vy] = (await page.evaluate((p) => window.__HAI_VIEWER__?.project(p), point)) ?? [0, 0];
  const box = await viewerBox(page);
  return {
    x: box.x + vx * box.width,
    y: box.y + vy * box.height,
    inView: vx > 0.05 && vx < 0.95 && vy > 0.1 && vy < 0.9,
  };
}

async function mouseDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  button: "left" | "right" = "left",
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up({ button });
}

async function start(page: Page) {
  bridge = await startTestBridge(page);
  await openViewer(page);
  await expect(activeTool(page)).toBeVisible();
}

test.describe("palette", () => {
  test("default tool on start: Select is active and shown", async ({ page }) => {
    await start(page);
    await expect(activeTool(page)).toHaveAttribute("data-tool", "select");
    await expect(activeTool(page)).toContainText("Select");
  });

  test("keyboard opens the action ring at the pointer; moving right and releasing chooses Copy", async ({
    page,
  }) => {
    await start(page);
    const box = await viewerBox(page);
    const centre = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.5 };
    await page.mouse.move(centre.x, centre.y);
    await page.keyboard.down(" ");
    const palette = page.getByTestId("tool-palette");
    await expect(palette).toBeVisible();
    const at = await palette.boundingBox();
    expect(Math.abs((at?.x ?? 0) + (at?.width ?? 0) / 2 - centre.x)).toBeLessThan(2);
    expect(Math.abs((at?.y ?? 0) + (at?.height ?? 0) / 2 - centre.y)).toBeLessThan(2);
    await page.mouse.move(centre.x + 80, centre.y + 3, { steps: 4 });
    await expect(page.getByTestId("palette-slot-2")).toHaveAttribute("data-highlighted", "true");
    await page.keyboard.up(" ");
    await expect(palette).toHaveCount(0);
    await expect(activeTool(page)).toHaveAttribute("data-tool", "copy");
  });

  test("release in the centre cancels: the tool is unchanged", async ({ page }) => {
    await start(page);
    await page.keyboard.press("m");
    await page.keyboard.down(" ");
    await expect(page.getByTestId("tool-palette")).toBeVisible();
    await page.keyboard.up(" ");
    await expect(page.getByTestId("tool-palette")).toHaveCount(0);
    await expect(activeTool(page)).toHaveAttribute("data-tool", "move");
  });

  test("holding the right button opens the palette; a quick right drag still pans", async ({ page }) => {
    await start(page);
    const box = await viewerBox(page);
    const centre = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.5 };
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down({ button: "right" });
    await expect(page.getByTestId("tool-palette")).toBeVisible();
    await page.mouse.move(centre.x + 64, centre.y - 64, { steps: 4 }); // top right: Move
    await page.mouse.up({ button: "right" });
    await expect(activeTool(page)).toHaveAttribute("data-tool", "move");

    const before = await camera(page);
    await mouseDrag(page, centre, { x: centre.x + 120, y: centre.y }, "right");
    await expect(page.getByTestId("tool-palette")).toHaveCount(0);
    expect((await camera(page)).target).not.toEqual(before.target);
  });

  test("a silent long pinch opens the action ring at the hand; flicking right and releasing chooses Copy", async ({
    page,
  }) => {
    await start(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    const ts = await now(page);
    const p = await handAt(page, [0.4, 0.5]);
    const right: [number, number] = [p[0] + 0.12, p[1]];
    const ev = (type: string, dt: number, position: [number, number], extra = {}) => ({
      type,
      ts: ts + dt,
      confidence: 1,
      hand: "Right",
      position,
      ...extra,
    });
    await page.evaluate(
      (events) => window.__HAI_INPUT__?.gestures(events),
      [ev("pinch.drag.start", 0, p), ev("pinch.hold", 600, p)],
    );
    await expect(page.getByTestId("tool-palette")).toBeVisible();
    await page.evaluate(
      (events) => window.__HAI_INPUT__?.gestures(events),
      [ev("pinch.drag.update", 650, right, { delta: [0.12, 0] })],
    );
    await expect(page.getByTestId("palette-slot-2")).toHaveAttribute("data-highlighted", "true");
    await page.evaluate(
      (events) => window.__HAI_INPUT__?.gestures(events),
      [ev("pinch.drag.end", 700, right)],
    );
    await expect(activeTool(page)).toHaveAttribute("data-tool", "copy");
  });

  test("a still fist returns to Select after 1.5 s; a shorter fist does not", async ({ page }) => {
    await start(page);
    await page.keyboard.press("m");
    const clutch = (type: string) =>
      page.evaluate(
        ({ type, ts }) => window.__HAI_INPUT__?.gestures([{ type, ts, confidence: 1, hand: "Right" }]),
        { type, ts: Date.now() },
      );
    await clutch("clutch.start");
    await page.waitForTimeout(1000);
    await clutch("clutch.end");
    await page.waitForTimeout(800);
    await expect(activeTool(page)).toHaveAttribute("data-tool", "move");
    await clutch("clutch.start");
    await page.waitForTimeout(1200);
    await expect(activeTool(page)).toHaveAttribute("data-tool", "move");
    await expect(activeTool(page)).toHaveAttribute("data-tool", "select", { timeout: 1500 });
  });

  test("every built-in tool has a single-key shortcut", async ({ page }) => {
    await start(page);
    for (const [key, id] of [
      ["m", "move"],
      ["d", "measure"],
      ["s", "section"],
      ["b", "massing"],
      ["x", "delete"],
      ["v", "select"],
    ]) {
      await page.keyboard.press(key as string);
      await expect(activeTool(page)).toHaveAttribute("data-tool", id as string);
    }
  });

  test("a tool registered at runtime appears in palette settings", async ({ page }) => {
    await start(page);
    await page.evaluate(() =>
      window.__HAI_TOOLS__?.registry.register({
        id: "test-bake",
        label: "Bake to Rhino",
        icon: "M4 4h16v16H4z",
        shortcut: "j",
        spoken: ["bake"],
      }),
    );
    await openSettings(page, "rings");
    await expect(
      page.getByTestId("palette-setting-0").locator("option", { hasText: "Bake to Rhino" }),
    ).toHaveCount(1);
  });

  test("layout persists: Section moved to the top slot is still there after a reload", async ({ page }) => {
    await start(page);
    await openSettings(page, "rings");
    await page.getByTestId("palette-setting-0").selectOption("section");
    await page.waitForTimeout(300); // the bridge writes .hai/settings.json
    await page.reload();
    await openSettings(page, "rings");
    await expect(page.getByTestId("palette-setting-0")).toHaveValue("section");
    await closeSettings(page);
    await page.keyboard.down(" ");
    await expect(page.getByTestId("palette-slot-0")).toHaveAttribute("data-tool", "section");
    await page.keyboard.up(" ");
  });
});

test.describe("built-in tools", () => {
  test("snapped move: dragging Block C about 1.23 m east moves it 1200 mm; undo from the palette keeps Move", async ({
    page,
  }) => {
    await start(page);
    await page.keyboard.press("m");
    // Drag between two points on Block C's roof (3500 mm), 1230 mm apart along X, both in plain view.
    const pickAt = (p: Mm) =>
      page.evaluate((p) => {
        const v = window.__HAI_VIEWER__?.project(p);
        return v ? window.__HAI_VIEWER__?.pick(v[0], v[1]) : null;
      }, p);
    let roof: Mm | null = null;
    for (let x = 5_000; x <= 33_000 && !roof; x += 1_000) {
      for (const y of [21_000, 23_000, 25_000]) {
        if (
          (await pickAt([x, y, 3_500])) === "block-c" &&
          (await pickAt([x + 1_230, y, 3_500])) === "block-c"
        ) {
          roof = [x, y, 3_500];
          break;
        }
      }
    }
    if (!roof) throw new Error("Block C's roof is not visible");
    const from = await screenOf(page, roof);
    const to = await screenOf(page, [roof[0] + 1_230, roof[1], 3_500]);
    await mouseDrag(page, from, to);
    await expect.poll(async () => (await element(page, "block-c"))?.origin).toEqual([5_200, 20_000, 0]);

    // Undo is in the bottom slot.
    const box = await viewerBox(page);
    const centre = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
    await page.mouse.move(centre.x, centre.y);
    await page.keyboard.down(" ");
    await page.mouse.move(centre.x, centre.y + 90, { steps: 4 });
    await page.keyboard.up(" ");
    await expect.poll(async () => (await element(page, "block-c"))?.origin).toEqual([4_000, 20_000, 0]);
    await expect(activeTool(page)).toHaveAttribute("data-tool", "move");
  });

  test("drag on empty space with Move orbits the view and changes nothing", async ({ page }) => {
    await start(page);
    await page.keyboard.press("m");
    const box = await viewerBox(page);
    // Upper middle: empty sky, clear of the project bar, the chat on the left and the view cube on the right.
    const empty = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.25 };
    expect(await page.evaluate(() => window.__HAI_VIEWER__?.pick(0.7, 0.25))).toBeNull();
    const before = await camera(page);
    const origin = (await element(page, "block-c"))?.origin;
    await mouseDrag(page, empty, { x: empty.x + 150, y: empty.y });
    expect((await camera(page)).azimuth).not.toBe(before.azimuth);
    expect((await element(page, "block-c"))?.origin).toEqual(origin);
  });

  test("measure a wall: tapping two points 6000 mm apart on the south wall shows 6000 mm", async ({
    page,
  }) => {
    await start(page);
    await page.keyboard.press("d");
    // The south wall's outer face: y = 4000 - 150, its middle height above Level 1 (4500 + 1750).
    const a = await screenOf(page, [6_000, 3_850, 6_250]);
    const b = await screenOf(page, [12_000, 3_850, 6_250]);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    const label = page.getByTestId("measure-label");
    await expect(label).toBeVisible();
    const mm = Number((await label.textContent())?.replace(/[^0-9]/g, ""));
    expect(Math.abs(mm - 6_000)).toBeLessThanOrEqual(60);
    expect((await tools(page)).overlay.measure).toHaveLength(2);
  });

  test("lower the section: a downward drag lowers the cut and hides what is above it", async ({ page }) => {
    await start(page);
    const high = await page.evaluate(() => window.__HAI_VIEWER__?.project([30_000, 4_000, 19_000]));
    if (!high) throw new Error("no projection");
    expect(await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x, y), high)).toBe("block-b");
    await page.keyboard.press("s");
    await expect(page.getByTestId("section-status")).toContainText("21000 mm");
    const box = await viewerBox(page);
    await mouseDrag(
      page,
      { x: box.x + box.width * 0.5, y: box.y + box.height * 0.3 },
      { x: box.x + box.width * 0.5, y: box.y + box.height * 0.6 },
    );
    const height = (await tools(page)).overlay.sectionMm ?? 0;
    expect(height).toBeLessThan(19_000);
    await expect(page.getByTestId("section-status")).toContainText(`${height} mm`);
    expect(await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x, y), high)).not.toBe("block-b");
    await page.keyboard.press("v");
    await expect(page.getByTestId("section-status")).toBeVisible(); // stays after leaving the tool
    await page.getByTestId("section-clear").click();
    await expect(page.getByTestId("section-status")).toHaveCount(0);
  });

  test("place a block: Add massing creates a 6000 x 6000 x 3500 mm block at the snapped tap point", async ({
    page,
  }) => {
    await start(page);
    await page.keyboard.press("b");
    const before = Object.keys(
      (await page.evaluate(() => window.__HAI_SCENE__?.getSnapshot().doc?.elements)) ?? {},
    );
    let target: Mm | null = null;
    for (const candidate of [
      [44_040, 10_960, 0],
      [12_040, 30_960, 0],
      [-4_960, 10_040, 0],
    ] as Mm[]) {
      if ((await screenOf(page, candidate)).inView) {
        target = candidate;
        break;
      }
    }
    if (!target) throw new Error("no empty ground in view");
    const at = await screenOf(page, target);
    await page.mouse.click(at.x, at.y);
    await expect
      .poll(
        async () =>
          Object.keys((await page.evaluate(() => window.__HAI_SCENE__?.getSnapshot().doc?.elements)) ?? {})
            .length,
      )
      .toBe(before.length + 1);
    const elements = (await page.evaluate(() => window.__HAI_SCENE__?.getSnapshot().doc?.elements)) ?? {};
    const added = Object.values(elements).find((e) => !before.includes(e.id as string));
    expect(added?.type).toBe("massing");
    expect(added?.size).toEqual([6_000, 6_000, 3_500]);
    const [ox, oy] = (added?.origin ?? []) as number[];
    // Centred on the tap point snapped to 100 mm (the tap lands within a few mm of the target).
    expect(Math.abs((ox ?? 0) + 3_000 - Math.round(target[0] / 100) * 100)).toBeLessThanOrEqual(100);
    expect(Math.abs((oy ?? 0) + 3_000 - Math.round(target[1] / 100) * 100)).toBeLessThanOrEqual(100);
    expect(((ox ?? 0) + 3_000) % 100).toBe(0);
  });

  test("delete: a nod confirms, a shake cancels", async ({ page }) => {
    await start(page);
    await page.keyboard.press("x");
    const box = await viewerBox(page);
    const tapOn = async (id: string) => {
      const [x, y] = await findElementOnScreen(page, id);
      await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
    };
    const head = (type: string) =>
      page.evaluate(
        (type) => window.__HAI_INPUT__?.gestures([{ type, ts: Date.now(), confidence: 1 }]),
        type,
      );

    await tapOn("block-c");
    await expect(page.getByTestId("tool-question")).toContainText("Block C");
    await head("head.shake");
    await expect(page.getByTestId("tool-question")).toHaveCount(0);
    expect(await element(page, "block-c")).not.toBeNull();

    await tapOn("block-c");
    await expect(page.getByTestId("tool-question")).toBeVisible();
    await head("head.nod");
    await expect.poll(() => element(page, "block-c")).toBeNull();
  });

  test("delete: Enter confirms and Escape cancels", async ({ page }) => {
    await start(page);
    await page.keyboard.press("x");
    const box = await viewerBox(page);
    const [x, y] = await findElementOnScreen(page, "block-b");
    await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
    await page.keyboard.press("Escape");
    expect(await element(page, "block-b")).not.toBeNull();
    await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
    await page.keyboard.press("Enter");
    await expect.poll(() => element(page, "block-b")).toBeNull();
  });

  test("no agent: Ask agent says why and keeps the tool", async ({ page }) => {
    await start(page);
    await page.keyboard.press("d");
    await page.keyboard.press("a");
    await expect(page.getByTestId("tool-notice")).toContainText("agent is not available");
    await expect(activeTool(page)).toHaveAttribute("data-tool", "measure");
  });
});

test.describe("hand UX regressions", () => {
  const ev = (type: string, ts: number, position: [number, number], extra = {}) => ({
    type,
    ts,
    confidence: 1,
    hand: "Right",
    position,
    ...extra,
  });
  const inject = (page: Page, events: unknown[]) =>
    page.evaluate((events) => window.__HAI_INPUT__?.gestures(events as never[]), events);

  test("the hand pointer comes back after a long pinch opened the palette", async ({ page }) => {
    await start(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    const ts = await now(page);
    const p = await handAt(page, [0.4, 0.5]);
    await inject(page, [
      ev("pinch.drag.start", ts, p),
      ev("pinch.hold", ts + 600, p),
      ev("pinch.drag.end", ts + 700, p),
    ]);
    await page.evaluate((p) => window.__HAI_INPUT__?.pointer(p), p);
    await expect(page.getByTestId("hand-pointer-right")).toBeVisible();
  });

  test("Holding a grabbed object keeps holding it: still on the section plane, no ring opens and nothing listens", async ({
    page,
  }) => {
    await start(page);
    await page.keyboard.press("s");
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    const ts = await now(page);
    const p = await handAt(page, [0.5, 0.45]);
    await inject(page, [ev("pinch.drag.start", ts, p), ev("pinch.hold", ts + 600, p)]);
    await expect(page.getByTestId("tool-palette")).toHaveCount(0);
    await page.waitForTimeout(700); // past the moment a silent hold would show its ring
    await expect(page.getByTestId("tool-palette")).toHaveCount(0);
    await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "off");
    const before = (await tools(page)).overlay.sectionMm ?? 0;
    const lower: [number, number] = [p[0], p[1] + 0.15];
    await inject(page, [
      ev("pinch.drag.update", ts + 700, lower, { delta: [0, 0.15] }),
      ev("pinch.drag.end", ts + 800, lower),
    ]);
    expect((await tools(page)).overlay.sectionMm ?? 0).toBeLessThan(before);
  });

  test("a hand can press the HUD's buttons: cancel the tool, and undo again", async ({ page }) => {
    await start(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    const box = await viewerBox(page);
    const tapOnButton = async (testId: string) => {
      const b = await page.getByTestId(testId).boundingBox();
      if (!b) throw new Error(`${testId} not shown`);
      const at: [number, number] = [
        (b.x + b.width / 2 - box.x) / box.width,
        (b.y + b.height / 2 - box.y) / box.height,
      ];
      await inject(page, [ev("pinch.tap", await now(page), await handAt(page, at))]);
    };
    // Cancel: back to Select from the active tool chip.
    await page.keyboard.press("d");
    await tapOnButton("tool-cancel");
    await expect(activeTool(page)).toHaveAttribute("data-tool", "select");

    // Two changes, then undo twice without reopening the palette.
    await page.evaluate(() => {
      window.__HAI_SCENE__?.apply("Rename", [{ op: "update", id: "block-c", patch: { name: "C1" } }]);
    });
    await expect.poll(async () => (await element(page, "block-c"))?.name).toBe("C1");
    await page.evaluate(() => {
      window.__HAI_SCENE__?.apply("Rename", [{ op: "update", id: "block-c", patch: { name: "C2" } }]);
    });
    await expect.poll(async () => (await element(page, "block-c"))?.name).toBe("C2");
    await page.keyboard.press("u");
    await expect.poll(async () => (await element(page, "block-c"))?.name).toBe("C1");
    await tapOnButton("undo-again");
    await expect.poll(async () => (await element(page, "block-c"))?.name).toBe("Block C pavilion");
  });

  test("the pointer shows what a pinch would do: the tool's icon, red for Delete, press over a button", async ({
    page,
  }) => {
    await start(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    const pointer = page.getByTestId("hand-pointer-right");
    const pointAt = async (at: [number, number]) =>
      page.evaluate((p) => window.__HAI_INPUT__?.pointer(p), await handAt(page, at));
    await pointAt([0.3, 0.6]);
    await expect(pointer).toHaveAttribute("data-mode", "select");
    await expect(pointer.locator("svg")).toHaveCount(0);
    for (const [key, mode] of [
      ["m", "move"],
      ["d", "measure"],
      ["x", "delete"],
    ] as const) {
      await page.keyboard.press(key);
      await pointAt([0.3, 0.6]);
      await expect(pointer).toHaveAttribute("data-mode", mode);
      await expect(pointer.locator("svg")).toHaveCount(1);
    }
    // Over the cancel button, the pointer turns into a press.
    const box = await viewerBox(page);
    const b = await page.getByTestId("tool-cancel").boundingBox();
    if (!b) throw new Error("no cancel button");
    await pointAt([(b.x + b.width / 2 - box.x) / box.width, (b.y + b.height / 2 - box.y) / box.height]);
    await expect(pointer).toHaveAttribute("data-mode", "press");
    await expect(page.getByTestId("tool-cancel")).toHaveAttribute("data-hand-hover", "right");
  });

  test("the pointer survives a short tracking dropout, and shows dimmed when not engaged", async ({
    page,
  }) => {
    await start(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    const pointer = page.getByTestId("hand-pointer-right");
    await page.evaluate((p) => window.__HAI_INPUT__?.pointer(p), await handAt(page, [0.4, 0.5]));
    await expect(pointer).toBeVisible();
    // One frame without the hand: the pointer is still there 100 ms later, and gone after the 250 ms it waits. Timed in
    // the page, so round trips from the test never stretch the gap; a page too busy to look within 250 ms says so.
    const { early, gap } = await page.evaluate(async () => {
      const present = () => document.querySelector('[data-testid="hand-pointer-right"]') !== null;
      const started = performance.now();
      window.__HAI_INPUT__?.pointer(null);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { early: present(), gap: performance.now() - started };
    });
    expect(early || gap >= 250).toBe(true);
    await expect(pointer).toHaveCount(0);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(false));
    await page.evaluate((p) => window.__HAI_INPUT__?.pointer(p), await handAt(page, [0.4, 0.5]));
    await expect(pointer).toHaveAttribute("data-engaged", "false");
  });

  test("a head shake or Escape returns to Select", async ({ page }) => {
    await start(page);
    await page.keyboard.press("m");
    await page.evaluate(() =>
      window.__HAI_INPUT__?.gestures([{ type: "head.shake", ts: Date.now(), confidence: 1 }]),
    );
    await expect(activeTool(page)).toHaveAttribute("data-tool", "select");
    await page.keyboard.press("d");
    await page.keyboard.press("Escape");
    await expect(activeTool(page)).toHaveAttribute("data-tool", "select");
  });

  test("an ordinary pinch on Remove (not just a quick tap) removes the section", async ({ page }) => {
    await start(page);
    await page.keyboard.press("s");
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    const box = await viewerBox(page);
    const b = await page.getByTestId("section-clear").boundingBox();
    if (!b) throw new Error("no remove button");
    const at = await handAt(page, [
      (b.x + b.width / 2 - box.x) / box.width,
      (b.y + b.height / 2 - box.y) / box.height,
    ]);
    const ts = await now(page);
    // A pinch held about half a second: the recogniser reports it as a drag, not a tap.
    await inject(page, [
      ev("pinch.drag.start", ts, at),
      ev("pinch.drag.update", ts + 300, at, { delta: [0, 0] }),
      ev("pinch.drag.end", ts + 500, at),
    ]);
    await expect(page.getByTestId("section-status")).toHaveCount(0);
  });

  test("the Delete tool removes the section when tapping the plane", async ({ page }) => {
    await start(page);
    await page.keyboard.press("s");
    await page.keyboard.press("x");
    await expect(page.getByTestId("section-status")).toBeVisible();
    // A point on the section plane (at the top of the model) that is not over any element or HUD panel.
    const spot = await page.evaluate(() => {
      const rect = document.querySelector("[data-testid=viewer] canvas")?.getBoundingClientRect();
      const onCanvas = (x: number, y: number) =>
        rect &&
        document.elementFromPoint(rect.left + x * rect.width, rect.top + y * rect.height)?.tagName ===
          "CANVAS";
      for (let y = 0.15; y < 0.9; y += 0.02) {
        for (let x = 0.05; x < 0.95; x += 0.02) {
          if (
            window.__HAI_VIEWER__?.pick(x, y) === null &&
            window.__HAI_VIEWER__?.overSection(x, y) &&
            onCanvas(x, y)
          )
            return [x, y];
        }
      }
      return null;
    });
    if (!spot) throw new Error("no free spot on the plane");
    await page.mouse.click(box_(await viewerBox(page), spot).x, box_(await viewerBox(page), spot).y);
    await expect(page.getByTestId("section-status")).toHaveCount(0);
  });

  test("the section line can be grabbed from any tool: hover lights it, a drag on it moves the cut", async ({
    page,
  }) => {
    await start(page);
    await page.keyboard.press("s");
    await page.keyboard.press("v"); // back to Select; the section stays
    const outline = await page.evaluate(() => window.__HAI_VIEWER__?.sectionOutline() ?? []);
    expect(outline.length).toBeGreaterThanOrEqual(4);
    // The middle of the outline's lowest edge on screen (the front edge), in page pixels.
    const box = await viewerBox(page);
    const edges = outline.map((p, i) => [p, outline[(i + 1) % outline.length]] as const);
    const [a, b] = edges.reduce((best, e) =>
      (e[0][1] + (e[1]?.[1] ?? 0)) / 2 > (best[0][1] + (best[1]?.[1] ?? 0)) / 2 ? e : best,
    );
    const mid = {
      x: box.x + ((a[0] + (b?.[0] ?? 0)) / 2) * box.width,
      y: box.y + ((a[1] + (b?.[1] ?? 0)) / 2) * box.height,
    };
    await page.mouse.move(mid.x, mid.y);
    await expect(page.getByTestId("viewer")).toHaveAttribute("data-section-hover", "true");
    const before = (await tools(page)).overlay.sectionMm ?? 0;
    await mouseDrag(page, mid, { x: mid.x, y: mid.y + 150 });
    expect((await tools(page)).overlay.sectionMm ?? 0).toBeLessThan(before);
  });

  test("tapping the section line selects the section (the Section tool)", async ({ page }) => {
    await start(page);
    await page.keyboard.press("s");
    await page.keyboard.press("m");
    const outline = await page.evaluate(() => window.__HAI_VIEWER__?.sectionOutline() ?? []);
    const box = await viewerBox(page);
    const [p, q] = [outline[0], outline[1]];
    if (!p || !q) throw new Error("no outline");
    await page.mouse.click(box.x + ((p[0] + q[0]) / 2) * box.width, box.y + ((p[1] + q[1]) / 2) * box.height);
    await expect(activeTool(page)).toHaveAttribute("data-tool", "section");
  });
});
const box_ = (box: { x: number; y: number; width: number; height: number }, [x, y]: number[]) => ({
  x: box.x + (x ?? 0) * box.width,
  y: box.y + (y ?? 0) * box.height,
});
