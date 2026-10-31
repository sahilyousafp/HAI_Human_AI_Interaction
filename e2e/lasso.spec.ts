import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { handEvent, holdAt, type Point, releaseAt, toolSnapshot } from "./hands.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// Lasso select takes the reference ring's free slot (the other hand's long pinch, top left): a pinch and drag draws a
// loop, what is inside is selected, and the tool turns itself off when the pinch is released.
let bridge: (Bridge & { port: number }) | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

const selection = (page: Page) =>
  page.evaluate(() => (window.__HAI_SCENE__?.getSnapshot().selection ?? []) as string[]);

/** A rectangle's corners as viewer positions, going round. */
const around = ([x0, y0, x1, y1]: [number, number, number, number]): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

async function start(page: Page) {
  bridge = await startTestBridge(page);
  await openViewer(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
}

/** The left hand's loop: a pinch that starts, goes round the corners and lets go where it began. */
async function drawLoop(page: Page, corners: Point[], options: { release?: boolean } = {}) {
  const [first, ...rest] = corners as [Point, ...Point[]];
  await handEvent(page, "Left", "pinch.drag.start", first);
  for (const corner of rest) await handEvent(page, "Left", "pinch.drag.update", corner);
  if (options.release !== false) await handEvent(page, "Left", "pinch.drag.end", first);
}

test("the other hand's ring has Lasso select at the top left, and flicking there picks it", async ({
  page,
}) => {
  await start(page);
  const reference = await page.evaluate(() => {
    const tools = window.__HAI_TOOLS__?.getSnapshot() as unknown as
      | { layouts: { reference: string[] } }
      | undefined;
    return tools?.layouts.reference ?? [];
  });
  expect(reference[7]).toBe("lasso");
  const at: Point = [0.5, 0.5];
  await holdAt(page, at, "Left");
  await expect(page.getByTestId("tool-palette")).toHaveAttribute("data-ring", "reference");
  await expect(page.getByTestId("palette-slot-7")).toContainText("lasso");
  await releaseAt(page, [at[0] - 0.1, at[1] - 0.14], "Left");
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "lasso");
});

test("a loop selects what is inside it, shows while it is drawn, and turns itself off on release", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("g");
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "lasso");
  const whole = around([0.04, 0.12, 0.96, 0.94]);
  await drawLoop(page, whole, { release: false });
  await expect(page.getByTestId("lasso-outline")).toBeVisible();
  expect((await toolSnapshot(page)).activeId).toBe("lasso");
  await handEvent(page, "Left", "pinch.drag.end", whole[0] as Point);
  await expect(page.getByTestId("lasso-outline")).toHaveCount(0);
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "select");
  expect((await selection(page)).length).toBeGreaterThan(1);
});

test("a loop around empty ground selects nothing and still turns itself off", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__HAI_SCENE__?.select(["col-a1"]));
  await page.keyboard.press("g");
  await drawLoop(page, around([0.02, 0.6, 0.12, 0.7]));
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "select");
  expect(await selection(page)).toEqual([]);
});

test("a slip too small to be a loop keeps the tool for another try", async ({ page }) => {
  await start(page);
  await page.keyboard.press("g");
  await drawLoop(page, around([0.5, 0.5, 0.504, 0.504]));
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "lasso");
});
