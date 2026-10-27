import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { camera, openViewer, startTestBridge } from "./viewer.ts";

// The view cube at the viewport's right: true orthographic views, drawing in a side view's plane, and the way back.
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

/** A press on a face of the cube (the faces are turned in 3D, so the click goes straight to the element). */
const face = (page: Page, id: string) => page.getByTestId(`view-${id}`).dispatchEvent("click");
const viewer = (page: Page) => page.getByTestId("viewer");

/**
 * How far apart (a fraction of the view) two points at different heights above the same ground point land on screen:
 * well apart in perspective, the same place in a top view.
 */
const parallax = (page: Page) =>
  page.evaluate(() => {
    const v = window.__HAI_VIEWER__;
    const low = v?.project([30_000, 10_000, 0]);
    const high = v?.project([30_000, 10_000, 20_000]);
    return low && high ? Math.hypot(low[0] - high[0], low[1] - high[1]) : null;
  });

test("the cube is there from the start, perspective is current, and it shows six faces and a way back", async ({
  page,
}) => {
  await start(page);
  await expect(viewer(page)).toHaveAttribute("data-view", "perspective");
  await expect(page.getByTestId("view-perspective")).toHaveAttribute("aria-pressed", "true");
  for (const id of ["top", "bottom", "front", "back", "left", "right"])
    await expect(page.getByTestId(`view-${id}`)).toHaveCount(1);
});

test("Top is a true plan: the camera looks straight down, verticals collapse to points, Perspective returns", async ({
  page,
}) => {
  await start(page);
  const before = await camera(page);
  expect(await parallax(page)).toBeGreaterThan(0.05);
  await face(page, "top");
  await expect(viewer(page)).toHaveAttribute("data-view", "top");
  await expect.poll(async () => (await camera(page)).elevation).toBeGreaterThan(89.9);
  await expect.poll(() => parallax(page)).toBeLessThan(0.002);
  await expect(page.getByTestId("view-top")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("view-perspective").click();
  await expect(viewer(page)).toHaveAttribute("data-view", "perspective");
  await expect.poll(async () => (await camera(page)).elevation).toBeCloseTo(before.elevation, 0);
  expect(await parallax(page)).toBeGreaterThan(0.05);
});

test("each side view looks from its side with the horizon level", async ({ page }) => {
  await start(page);
  for (const [id, azimuth] of [
    ["front", 270],
    ["back", 90],
    ["right", 0],
    ["left", 180],
  ] as const) {
    await face(page, id);
    await expect(viewer(page)).toHaveAttribute("data-view", id);
    await expect.poll(async () => Math.round((await camera(page)).elevation)).toBe(0);
    await expect
      .poll(async () => Math.round((((await camera(page)).azimuth % 360) + 360) % 360))
      .toBe(azimuth);
  }
});

test("orbiting leaves an orthographic view, panning and zooming keep it", async ({ page }) => {
  await start(page);
  await face(page, "front");
  await expect(viewer(page)).toHaveAttribute("data-view", "front");
  const canvas = page.locator("[data-testid=viewer] canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  // A wheel turn zooms, a right-button drag pans: both stay in the view.
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -200);
  await mouseDrag(page, [cx, cy], [cx + 80, cy + 40], "right");
  await expect(viewer(page)).toHaveAttribute("data-view", "front");
  // A left-button drag orbits: back to perspective.
  await mouseDrag(page, [cx, cy], [cx + 120, cy], "left");
  await expect(viewer(page)).toHaveAttribute("data-view", "perspective");
});

async function mouseDrag(page: Page, from: [number, number], to: [number, number], button: "left" | "right") {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down({ button });
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.mouse.up({ button });
}

test("a Line drawn in the Front view lies in a vertical plane: Ortho at 90 degrees makes it upright", async ({
  page,
}) => {
  await start(page);
  await face(page, "front");
  await expect(viewer(page)).toHaveAttribute("data-view", "front");
  await page.keyboard.press("n");
  await page.getByTestId("constraint-ortho").click();
  await page.getByTestId("constraint-step-90").click();
  const canvas = page.locator("[data-testid=viewer] canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  const [cx, cy] = [box.x + box.width * 0.55, box.y + box.height * 0.7];
  await page.mouse.click(cx, cy);
  // Up the screen and a little to the side: Ortho holds it upright.
  await page.mouse.click(cx + 25, cy - 220);
  await page.keyboard.press("Enter");
  await expect
    .poll(() => Object.values(bridge?.scene.scene.doc.elements ?? {}).filter((e) => e.type === "line").length)
    .toBe(1);
  const line = Object.values(bridge?.scene.scene.doc.elements ?? {}).find((e) => e.type === "line");
  if (line?.type !== "line") throw new Error("no line");
  const [a, b] = line.points;
  expect(b?.[0]).toBe(a?.[0]); // upright: same x
  expect(b?.[1]).toBe(a?.[1]); // in the Front view's plane: same y
  expect((b?.[2] ?? 0) - (a?.[2] ?? 0)).toBeGreaterThan(1000);
});

test("Wall draws in plan: in a side view its drag places nothing", async ({ page }) => {
  await start(page);
  await face(page, "front");
  await page.keyboard.press("w");
  const canvas = page.locator("[data-testid=viewer] canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  const before = Object.keys(bridge?.scene.scene.doc.elements ?? {}).length;
  await mouseDrag(page, [box.x + 500, box.y + 400], [box.x + 700, box.y + 400], "left");
  await page.waitForTimeout(300);
  expect(Object.keys(bridge?.scene.scene.doc.elements ?? {}).length).toBe(before);
});
