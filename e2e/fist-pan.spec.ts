import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { pan, type Turntable } from "../apps/web/src/viewer/turntable.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { camera, handAt, now, openViewer, startTestBridge } from "./viewer.ts";

// A fist closed at rest and then moved pans the view (the model follows the hand); holding it still is the cancel.
// Hand input is injected into the same bus the tracker feeds. Engagement is enforced by the recogniser before events
// reach the bus, so "nothing happens while not engaged" is covered by its unit tests.
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

type Hand = "Left" | "Right";
type Point = [number, number];

const start = async (page: Page) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
};

async function send(
  page: Page,
  type: string,
  hand: Hand,
  ts: number,
  position: Point,
  delta: Point = [0, 0],
) {
  await page.evaluate((e) => window.__AEX_INPUT__?.gestures([{ confidence: 1, ...e } as never]), {
    type,
    hand,
    ts,
    position,
    delta,
  });
}

/** A fist drag: closes, moves `steps` times by `dx` (a fraction of the frame width), and optionally lets go. */
async function fistDrag(
  page: Page,
  hand: Hand,
  { dx, steps, rest = 0, release = true }: { dx: number; steps: number; rest?: number; release?: boolean },
) {
  const t0 = await now(page);
  let x = 0.4;
  await send(page, "fist.drag.start", hand, t0, [x, 0.5]);
  let ts = t0;
  for (let i = 0; i < steps; i++) {
    ts += 33;
    x += dx;
    await send(page, "fist.drag.update", hand, ts, [x, 0.5], [dx, 0]);
  }
  if (release) await send(page, "fist.drag.end", hand, ts + rest, [x, 0.5]);
}

const turntable = (c: Awaited<ReturnType<typeof camera>>): Turntable => c;

test("a fist dragged 10% to the right slides the model 0.12 view heights to the right, as the two-hand pan does", async ({
  page,
}) => {
  await start(page);
  const before = await camera(page);
  await fistDrag(page, "Left", { dx: 0.01, steps: 10, rest: 400 }); // held still before letting go: no coast
  const after = await camera(page);
  const expected = pan(turntable(before), -0.1 * 1.2, 0);
  for (const [i, v] of after.target.entries()) expect(v).toBeCloseTo(expected.target[i] ?? 0, 6);
  expect(after.distance).toBe(before.distance);
  expect(after.azimuth).toBe(before.azimuth);
  expect(after.elevation).toBe(before.elevation);
});

test("it pans with the Wall tool active, and starts no wall", async ({ page }) => {
  await start(page);
  await page.keyboard.press("w");
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "wall");
  const elements = await page.evaluate(() => window.__AEX_VIEWER__?.meshCount());
  const before = await camera(page);
  await fistDrag(page, "Right", { dx: 0.01, steps: 10, rest: 400 });
  expect((await camera(page)).target).not.toEqual(before.target);
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "wall");
  expect(await page.evaluate(() => window.__AEX_VIEWER__?.meshCount())).toBe(elements);
});

test("a flick keeps the model sliding after the fist opens", async ({ page }) => {
  await start(page);
  await fistDrag(page, "Left", { dx: 0.03, steps: 6 }); // released while still moving fast
  const atRelease = await camera(page);
  await expect.poll(async () => (await camera(page)).target[0]).not.toBe(atRelease.target[0]);
  const later = await camera(page);
  expect(Math.hypot(...later.target.map((v, i) => v - (atRelease.target[i] ?? 0)))).toBeGreaterThan(0);
});

test("a moving fist never cancels the tool, while a still fist held for 1.5 s does", async ({ page }) => {
  await start(page);
  await page.keyboard.press("m");
  const tool = page.getByTestId("active-tool");
  await expect(tool).toHaveAttribute("data-tool", "move");
  // The fist closes (the clutch starts the hold), then moves and keeps panning for 2 s.
  await send(page, "clutch.start", "Left", await now(page), [0.4, 0.5]);
  await fistDrag(page, "Left", { dx: 0.002, steps: 60, release: false });
  await page.waitForTimeout(2000);
  await expect(tool).toHaveAttribute("data-tool", "move");
  await send(page, "fist.drag.end", "Left", await now(page), [0.5, 0.5]);
  await send(page, "clutch.end", "Left", await now(page), [0.5, 0.5]);
  // A fist that stays still for 1.5 s cancels back to Select, but not before.
  await send(page, "clutch.start", "Left", await now(page), [0.4, 0.5]);
  await page.waitForTimeout(1200);
  await expect(tool).toHaveAttribute("data-tool", "move");
  await expect(tool).toHaveAttribute("data-tool", "select", { timeout: 1500 });
});

test("the left hand's fist drag does not move the view while the right hand orbits", async ({ page }) => {
  await start(page);
  const initial = await camera(page);
  const t0 = await now(page);
  await send(page, "pinch.drag.start", "Right", t0, [0.5, 0.5]);
  await send(page, "pinch.drag.update", "Right", t0 + 33, [0.55, 0.5], [0.05, 0]);
  const orbiting = await camera(page);
  expect(orbiting.azimuth).not.toBe(initial.azimuth);
  await fistDrag(page, "Left", { dx: 0.01, steps: 10, rest: 400 });
  const after = await camera(page);
  expect(after.target).toEqual(orbiting.target);
  expect(after.azimuth).toBe(orbiting.azimuth);
  await send(page, "pinch.drag.update", "Right", t0 + 99, [0.6, 0.5], [0.05, 0]);
  expect((await camera(page)).azimuth).not.toBe(orbiting.azimuth);
});

test("set to nothing on one hand, that hand's fist stays a clutch; the other hand still pans", async ({
  page,
}) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  await openSettings(page, "gestures");
  await page.getByTestId("gesture-fistdrag-left").selectOption("none");
  await closeSettings(page);
  await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
  const before = await camera(page);
  await fistDrag(page, "Left", { dx: 0.01, steps: 10, rest: 400 });
  expect((await camera(page)).target).toEqual(before.target);
  await fistDrag(page, "Right", { dx: 0.01, steps: 10, rest: 400 });
  expect((await camera(page)).target).not.toEqual(before.target);
});

test.describe("the hand pointer shows pan", () => {
  /** Puts both hands' pointers in view, on open ground. */
  async function showPointers(page: Page) {
    const left = await handAt(page, [0.55, 0.6]);
    const right = await handAt(page, [0.7, 0.6]);
    await page.evaluate(([r, l]) => window.__AEX_INPUT__?.pointer(r, l), [right, left] as const);
  }

  test("a closed hand shows the pan icon, filled while the view moves, and the ring returns when it opens", async ({
    page,
  }) => {
    await start(page);
    await showPointers(page);
    const pointer = page.getByTestId("hand-pointer-left");
    await expect(pointer).toHaveAttribute("data-mode", "select");
    await send(page, "clutch.start", "Left", await now(page), [0.4, 0.5]);
    await expect(pointer).toHaveAttribute("data-mode", "pan");
    await expect(pointer).toHaveAttribute("data-panning", "false");
    await expect(pointer.locator("svg")).toBeVisible();
    // The other hand's pointer is unaffected.
    await expect(page.getByTestId("hand-pointer-right")).toHaveAttribute("data-mode", "select");
    await fistDrag(page, "Left", { dx: 0.01, steps: 6, release: false });
    await expect(pointer).toHaveAttribute("data-panning", "true");
    await send(page, "fist.drag.end", "Left", await now(page), [0.5, 0.5]);
    await expect(pointer).toHaveAttribute("data-panning", "false");
    await send(page, "clutch.end", "Left", await now(page), [0.5, 0.5]);
    await expect(pointer).toHaveAttribute("data-mode", "select");
  });

  test("set to nothing or to orbit, a closed hand does not show the pan icon", async ({ page }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    await openSettings(page, "gestures");
    await page.getByTestId("gesture-fistdrag-left").selectOption("none");
    await page.getByTestId("gesture-fistdrag-right").selectOption("orbit");
    await closeSettings(page);
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
    await showPointers(page);
    for (const hand of ["Left", "Right"] as const) {
      await send(page, "clutch.start", hand, await now(page), [0.4, 0.5]);
      await expect(page.getByTestId(`hand-pointer-${hand.toLowerCase()}`)).toHaveAttribute(
        "data-mode",
        "select",
      );
    }
  });

  test("a pinch drag set to pan shows the filled pan icon while it moves the view", async ({ page }) => {
    bridge = await startTestBridge(page);
    await openViewer(page);
    await openSettings(page, "gestures");
    await page.getByTestId("gesture-drag-right").selectOption("pan");
    await closeSettings(page);
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
    await showPointers(page);
    const pointer = page.getByTestId("hand-pointer-right");
    const t0 = await now(page);
    await send(page, "pinch.drag.start", "Right", t0, [0.5, 0.5]);
    await send(page, "pinch.drag.update", "Right", t0 + 33, [0.55, 0.5], [0.05, 0]);
    await expect(pointer).toHaveAttribute("data-mode", "pan");
    await expect(pointer).toHaveAttribute("data-panning", "true");
    await send(page, "pinch.drag.end", "Right", t0 + 400, [0.55, 0.5]);
    await expect(pointer).toHaveAttribute("data-mode", "select");
  });

  test("while not engaged the pointer stays dimmed with no pan icon", async ({ page }) => {
    await start(page);
    await showPointers(page);
    await send(page, "clutch.start", "Left", await now(page), [0.4, 0.5]);
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(false));
    const pointer = page.getByTestId("hand-pointer-left");
    await expect(pointer).toHaveAttribute("data-engaged", "false");
    await expect(pointer).toHaveAttribute("data-mode", "idle");
    await expect(pointer.locator("svg")).toHaveCount(0);
  });
});
