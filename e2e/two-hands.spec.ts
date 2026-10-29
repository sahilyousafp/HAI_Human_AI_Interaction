import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { allow } from "./budget.ts";
import { openSettings } from "./settings.ts";
import { handAt, now, openViewer, startTestBridge } from "./viewer.ts";

// Both hands are pointers: each taps, presses, scrolls and opens its own ring. Hand input is injected into the same
// bus the tracker feeds, with each hand's pinch point.
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

type Hand = "Left" | "Right";
type Point = [number, number];

async function gesture(page: Page, type: string, hand: Hand, position: Point, ts?: number) {
  const at = ts ?? (await now(page));
  await page.evaluate(
    (e) => window.__HAI_INPUT__?.gestures([{ confidence: 1, delta: [0, 0], ...e } as never]),
    { type, hand, position, ts: at },
  );
}

/** The viewer position (it may lie beyond the viewer, over the sidebar) of an element's centre. */
async function viewerPointOf(page: Page, selector: string): Promise<Point> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const viewer = await page.getByTestId("viewer").boundingBox();
  if (!box || !viewer) throw new Error(`${selector} is not laid out`);
  return [
    (box.x + box.width / 2 - viewer.x) / viewer.width,
    (box.y + box.height / 2 - viewer.y) / viewer.height,
  ];
}

/** Two viewer points on open ground (nothing to pick), clear of the panels on the model's left. */
async function openGround(page: Page): Promise<[Point, Point]> {
  return page.evaluate(() => {
    const v = window.__HAI_VIEWER__;
    if (!v) throw new Error("viewer not ready");
    const canvas = document.querySelector("[data-testid=viewer] canvas");
    const box = canvas?.getBoundingClientRect();
    // Open ground: no element there, and the model itself on top (not a panel, the status strip or the camera).
    const clear = (x: number, y: number) =>
      v.pick(x, y) === null &&
      !!box &&
      document.elementFromPoint(box.left + x * box.width, box.top + y * box.height) === canvas;
    for (let y = 0.95; y >= 0.3; y -= 0.05) {
      for (let x = 0.05; x <= 0.8; x += 0.05) {
        if (clear(x, y) && clear(x + 0.08, y) && clear(x + 0.16, y))
          return [
            [x, y],
            [x + 0.16, y],
          ];
      }
    }
    throw new Error("no open ground in view");
  });
}

test("the left hand opens the settings and switches a feature off, each control lit while pointed at", async ({
  page,
}) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  const right = await handAt(page, [0.4, 0.5]);
  /** Points the left hand at a control, checks it lights up, and taps it. */
  const pressByHand = async (testId: string) => {
    const hand = await handAt(page, await viewerPointOf(page, `[data-testid="${testId}"]`));
    await page.evaluate(([r, l]) => window.__HAI_INPUT__?.pointer(r, l), [right, hand] as const);
    await expect(page.getByTestId("hand-pointer-left")).toHaveAttribute("data-mode", "press");
    await expect(page.getByTestId(testId)).toHaveAttribute("data-hand-hover", "left");
    await gesture(page, "pinch.tap", "Left", hand);
  };
  await expect(page.getByTestId("hud-latency")).toBeVisible();
  await pressByHand("settings-button"); // in the toolbar: the hands reach the whole window
  await expect(page.getByTestId("settings-panel")).toHaveAttribute("data-open", "true");
  await page.waitForTimeout(500); // the sheet slides in
  if (await page.getByTestId("settings-back").isVisible()) await page.getByTestId("settings-back").click();
  await pressByHand("settings-open-features");
  await pressByHand("feature-latencyReadout");
  await expect(page.getByTestId("feature-latencyReadout")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("hud-latency")).toHaveCount(0);
  // The hand that pinched last drives hover in the model and what "this" means.
  await expect(page.getByTestId("hand-pointer-left")).toHaveAttribute("data-focus", "true");
});

test("the right hand's silent long pinch shows the action ring; Wall draws a wall by hand, and one Undo removes it", async ({
  page,
}) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  const existing = new Set(Object.keys(bridge.scene.scene.doc.elements));
  const before = existing.size;

  // A silent long pinch with the dominant (right) hand shows the action ring; steer left, let go: Wall.
  const centre = await handAt(page, [0.6, 0.5]);
  await gesture(page, "pinch.drag.start", "Right", centre);
  await gesture(page, "pinch.hold", "Right", centre);
  const palette = page.getByTestId("tool-palette");
  await expect(palette).toHaveAttribute("data-ring", "action");
  await expect(palette).toHaveAttribute("data-hand", "right");
  await expect(page.getByTestId("palette-slot-6")).toHaveAttribute("data-tool", "wall");
  await gesture(page, "pinch.drag.update", "Right", [centre[0] - 0.15, centre[1]]);
  await expect(page.getByTestId("palette-slot-6")).toHaveAttribute("data-highlighted", "true");
  await gesture(page, "pinch.drag.end", "Right", [centre[0] - 0.15, centre[1]]);
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "wall");

  // Draw it: pinch on open ground and drag.
  const [a, b] = await openGround(page);
  const [ha, hb] = [await handAt(page, a), await handAt(page, b)];
  await gesture(page, "pinch.drag.start", "Left", ha);
  for (let i = 1; i <= 5; i++) {
    await gesture(page, "pinch.drag.update", "Left", [ha[0] + ((hb[0] - ha[0]) * i) / 5, ha[1]]);
  }
  const draft = await page.evaluate(() => window.__HAI_TOOLS__?.getSnapshot().overlay.draft?.type);
  expect(draft).toBe("wall");
  await expect(page.getByTestId("tool-notice")).toContainText(/^Wall \d+ mm/);
  await gesture(page, "pinch.drag.end", "Left", hb);
  await expect.poll(() => Object.keys(bridge?.scene.scene.doc.elements ?? {}).length).toBe(before + 1);
  const wall = Object.values(bridge.scene.scene.doc.elements).find((e) => !existing.has(e.id));
  expect(wall).toMatchObject({ type: "wall", thickness: 200, height: 3000 });

  await page.keyboard.press("Control+z");
  await expect.poll(() => Object.keys(bridge?.scene.scene.doc.elements ?? {}).length).toBe(before);
});

test("a pinch-drag scrolls the settings with the hand, and a quick release coasts on", async ({ page }) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  await openSettings(page, "gestures");
  await page.waitForTimeout(500); // the sheet slides in
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  const body = page.locator(".settings-body");
  const scrollTop = () => body.evaluate((el) => el.scrollTop);
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // A spot in the list that is not a control: a gesture's description.
  const at = await viewerPointOf(page, '[data-slot="tap"] .gesture-what');
  await body.evaluate((el) => {
    el.scrollTop = 0;
  });
  const start = await handAt(page, at);
  // The hand moves up quickly (about a fifth of the view's height in 80 ms) and lets go. The coast follows how fast the
  // hand moved in the last 100 ms, by the page's clock, so the whole gesture runs in one task of the page, 20 ms
  // apart by a spin on that clock: a timer or a round trip between the moves, or before the release, can bunch up or
  // stretch on a slow machine and make the hand look still.
  const followed = await page.evaluate((from) => {
    const send = (type: string, position: number[]) =>
      window.__HAI_INPUT__?.gestures([
        {
          type,
          hand: "Right",
          position,
          ts: performance.timeOrigin + performance.now(),
          confidence: 1,
          delta: [0, 0],
        } as never,
      ]);
    const [x, y] = from as [number, number];
    send("pinch.drag.start", [x, y]);
    for (let i = 1; i <= 4; i++) {
      for (const until = performance.now() + 20; performance.now() < until; ) {
        // spin
      }
      send("pinch.drag.update", [x, y - 0.04 * i]);
    }
    const scrolled = document.querySelector(".settings-body")?.scrollTop ?? 0;
    send("pinch.drag.end", [x, y - 0.16]);
    return scrolled;
  }, start);
  expect(followed).toBeGreaterThan(50); // the content moved up with the hand
  await expect.poll(scrollTop, { timeout: allow(2000, 8000) }).toBeGreaterThan(followed + 20); // and coasts on after letting go
});
