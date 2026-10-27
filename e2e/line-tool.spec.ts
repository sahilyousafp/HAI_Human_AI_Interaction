import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { openGround, type Point, viewerOf } from "./hands.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// The Line tool and the drawing constraints panel: Ortho as a hard lock, its angle step, a locked length.
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

async function start(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  bridge = await startTestBridge(page);
  await openViewer(page);
}

/** Where a ground point (mm) is on the page, px. */
async function onPage(page: Page, at: Point): Promise<Point> {
  const view = await viewerOf(page, at);
  const box = await page.locator("[data-testid=viewer] canvas").boundingBox();
  if (!view || !box) throw new Error(`${at} is not clear on screen`);
  return [box.x + view[0] * box.width, box.y + view[1] * box.height];
}

const click = async (page: Page, at: Point) => {
  const [x, y] = await onPage(page, at);
  await page.mouse.click(x, y);
};

const lines = () =>
  Object.values(bridge?.scene.scene.doc.elements ?? {}).filter((e) => e.type === "line") as Array<{
    type: "line";
    points: Array<[number, number, number]>;
    closed: boolean;
    level?: string;
  }>;

test("the constraints panel shows while Line or Wall is active, and nowhere else", async ({ page }) => {
  await start(page);
  const panel = page.getByTestId("constraints");
  await expect(panel).toHaveCount(0);
  await page.keyboard.press("n");
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "line");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Line constraints");
  await page.keyboard.press("w");
  await expect(panel).toContainText("Wall constraints");
  await page.keyboard.press("v");
  await expect(panel).toHaveCount(0);
});

test("Ortho and the snaps in the panel are the Drawing aids in Settings, both ways", async ({ page }) => {
  await start(page);
  await page.keyboard.press("n");
  const ortho = page.getByTestId("constraint-ortho");
  await expect(ortho).toHaveAttribute("aria-pressed", "false");
  await ortho.click();
  await expect(ortho).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("constraint-aid-endpoint").click();
  await expect(page.getByTestId("aids-status")).toContainText("Ortho");
  await openSettings(page, "drawing-aids");
  await expect(page.getByTestId("aid-ortho")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("aid-endpoint")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("aid-ortho").click();
  await closeSettings(page);
  await expect(ortho).toHaveAttribute("aria-pressed", "false");
});

test("taps place the points, Enter finishes, and the line is one undo step on the ground level", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("n");
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await click(page, [x, y]);
  await click(page, [x + 6000, y]);
  await click(page, [x + 6000, y + 4000]);
  await page.keyboard.press("Enter");
  await expect.poll(() => lines().length).toBe(1);
  const [line] = lines();
  expect(line?.points).toHaveLength(3);
  expect(line?.closed).toBe(false);
  expect(line?.level).toBe("L0");
  // One step: a single Undo removes the whole line.
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect.poll(() => lines().length).toBe(0);
});

test("Ortho is a hard lock: a hand 20 degrees off the axis still draws along it, at the chosen step", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("n");
  await page.getByTestId("constraint-ortho").click();
  await page.getByTestId("constraint-step-90").click();
  await expect(page.getByTestId("constraint-step-90")).toHaveAttribute("aria-checked", "true");
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await click(page, [x, y]);
  // Beyond the old 7.5 degree window: 20 degrees off the X axis.
  await click(page, [x + 5000, y + 1800]);
  await page.keyboard.press("Enter");
  await expect.poll(() => lines().length).toBe(1);
  const [a, b] = lines()[0]?.points ?? [];
  expect(b?.[1]).toBe(a?.[1]);
  expect(Math.abs((b?.[0] ?? 0) - (a?.[0] ?? 0))).toBeGreaterThan(3000);
});

test("A locked length fixes the next segment, wherever the hand is, and is freed once it is placed", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("n");
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await click(page, [x, y]);
  await page.getByTestId("constraint-length").fill("2500");
  await page.getByTestId("constraint-lock").click();
  await expect(page.getByTestId("constraint-free")).toBeVisible();
  await click(page, [x + 5000, y + 3000]);
  await expect(page.getByTestId("constraint-lock")).toBeVisible(); // freed by the point
  await page.keyboard.press("Enter");
  await expect.poll(() => lines().length).toBe(1);
  const [a, b] = lines()[0]?.points ?? [];
  const length = Math.hypot((b?.[0] ?? 0) - (a?.[0] ?? 0), (b?.[1] ?? 0) - (a?.[1] ?? 0));
  expect(Math.abs(length - 2500)).toBeLessThanOrEqual(1.5);
});

test("Escape takes back the last point and a line of one point is never added", async ({ page }) => {
  await start(page);
  await page.keyboard.press("n");
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await click(page, [x, y]);
  await click(page, [x + 4000, y]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  expect(lines()).toHaveLength(0);
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "line");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "select");
});
