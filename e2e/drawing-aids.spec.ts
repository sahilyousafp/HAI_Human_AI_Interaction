import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// Drawing aids: switches in the settings that put the create tools' points exactly where they belong.
let bridge: (Bridge & { port: number }) | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

type Point = [number, number];

async function start(page: Page) {
  bridge = await startTestBridge(page);
  await openViewer(page);
}

/** Turns drawing aids on in the settings, then closes the sheet. */
async function turnOn(page: Page, ...aids: string[]) {
  await openSettings(page, "drawing-aids");
  for (const aid of aids) {
    const toggle = page.getByTestId(`aid-${aid}`);
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  }
  await closeSettings(page);
}

/** Where a point (millimetres, on the ground unless `z` says) is on screen, px; null if it is off the canvas. */
async function screenOf(page: Page, [x, y]: Point, z = 0): Promise<Point | null> {
  return page.evaluate(
    ([x, y, z]) => {
      const canvas = document.querySelector("[data-testid=viewer] canvas");
      const rect = canvas?.getBoundingClientRect();
      const at = window.__HAI_VIEWER__?.project([x, y, z]);
      if (!rect || !at) return null;
      const px = rect.left + at[0] * rect.width;
      const py = rect.top + at[1] * rect.height;
      // Clear of panels: the canvas itself is what is there, with some room around.
      const clear = [
        [0, 0],
        [30, 0],
        [-30, 0],
        [0, 30],
        [0, -30],
      ].every(([dx = 0, dy = 0]) => document.elementFromPoint(px + dx, py + dy) === canvas);
      return clear ? [px, py] : null;
    },
    [x, y, z] as const,
  );
}

/** A start point on open ground and an end point `dx`, `dy` mm from it, both on screen and clear of panels. */
async function groundSpan(page: Page, dx: number, dy: number): Promise<{ start: Point; end: Point }> {
  for (let y = 4000; y <= 30_000; y += 2000) {
    for (let x = 30_000; x >= 0; x -= 2000) {
      const a = await screenOf(page, [x, y]);
      const b = await screenOf(page, [x + dx, y + dy]);
      if (a && b) return { start: [x, y], end: [x + dx, y + dy] };
    }
  }
  throw new Error("no open ground in view");
}

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
}

type Wall = { type: "wall"; start: Point; end: Point; level?: string; base?: number };

/** The height of a wall of the sample project, millimetres: its own base, else its level's elevation. */
const baseOf = (wall: Wall): number =>
  wall.base ?? bridge?.scene.scene.doc.levels.find((l) => l.id === wall.level)?.elevation ?? 0;
const lastWall = (): Wall | undefined => {
  const walls = Object.values(bridge?.scene.scene.doc.elements ?? {}).filter((e) => e.type === "wall");
  return walls.at(-1) as Wall | undefined;
};

/** A wall of the sample project whose end is on screen with room around it, and that end. */
async function visibleWallEnd(page: Page): Promise<{ wall: Wall; end: Point; at: Point }> {
  const walls = Object.values(bridge?.scene.scene.doc.elements ?? {}).filter(
    (e) => e.type === "wall",
  ) as Wall[];
  for (const wall of walls) {
    for (const end of [wall.start, wall.end]) {
      const at = await screenOf(page, end, baseOf(wall));
      if (at) return { wall, end, at };
    }
  }
  throw new Error("no wall end is clear on screen");
}

test("the Drawing aids page has a switch for each aid, only Grid is on, and the choice is kept", async ({
  page,
}) => {
  await start(page);
  await openSettings(page, "drawing-aids");
  for (const aid of ["grid", "ortho", "endpoint", "midpoint", "centre", "project", "perpendicular"]) {
    await expect(page.getByTestId(`aid-${aid}`)).toBeVisible();
    await expect(page.getByTestId(`aid-${aid}`)).toHaveAttribute(
      "aria-checked",
      aid === "grid" ? "true" : "false",
    );
  }
  await page.getByTestId("aid-endpoint").click();
  await closeSettings(page);
  await expect(page.getByTestId("aids-status")).toContainText("Aids: Grid, Endpoint");
  await page.reload();
  await expect(page.getByTestId("aids-status")).toContainText("Aids: Grid, Endpoint");
});

test("Endpoint: a wall starts exactly on the end of another wall", async ({ page }) => {
  await start(page);
  await turnOn(page, "endpoint");
  const { end, at } = await visibleWallEnd(page);
  // The new wall runs 6 m from that end, whichever way is clear on screen.
  let to: Point | null = null;
  for (const [dx, dy] of [
    [6000, 0],
    [-6000, 0],
    [0, 6000],
    [0, -6000],
  ] as const) {
    to ??= await screenOf(page, [end[0] + dx, end[1] + dy]);
  }
  if (!to) throw new Error("no clear ground 6 m from the wall end");
  await page.keyboard.press("w");
  // Hovering shows what a start point would snap to; the label goes with the drag, which looks for the end.
  await page.mouse.move(at[0] + 9, at[1] + 6);
  await expect(page.getByTestId("snap-label")).toHaveText("Endpoint");
  await drag(page, [at[0] + 9, at[1] + 6], to);
  await page.mouse.up();
  await expect.poll(() => lastWall()?.start).toEqual(end);
});

test("Midpoint: a wall starts exactly at the middle of another", async ({ page }) => {
  await start(page);
  await turnOn(page, "midpoint");
  const walls = Object.values(bridge?.scene.scene.doc.elements ?? {}).filter(
    (e) => e.type === "wall",
  ) as Wall[];
  let found: { mid: Point; at: Point } | null = null;
  for (const w of walls) {
    const mid: Point = [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2];
    const at = await screenOf(page, mid, baseOf(w));
    if (at) {
      found = { mid, at };
      break;
    }
  }
  if (!found) throw new Error("no wall middle is clear on screen");
  const far = await groundSpan(page, 6000, 0);
  const to = await screenOf(page, far.end);
  await page.keyboard.press("w");
  await page.mouse.move(found.at[0] + 8, found.at[1] + 5);
  await expect(page.getByTestId("snap-label")).toHaveText("Midpoint");
  await drag(page, [found.at[0] + 8, found.at[1] + 5], to ?? found.at);
  await page.mouse.up();
  await expect.poll(() => lastWall()?.start).toEqual(found.mid);
});

test("Ortho: a wall drawn nearly along X ends on the axis, and the notice has length and angle", async ({
  page,
}) => {
  await start(page);
  await turnOn(page, "ortho");
  const span = await groundSpan(page, 5000, 300);
  const [from, to] = [await screenOf(page, span.start), await screenOf(page, span.end)];
  if (!from || !to) throw new Error("the span is off screen");
  await page.keyboard.press("w");
  await drag(page, from, to);
  await expect(page.getByTestId("tool-notice")).toContainText(/Wall \d+ mm at \d+(\.\d)? deg.*Ortho/);
  await page.mouse.up();
  await expect
    .poll(() => lastWall() !== undefined && (lastWall() as Wall).end[1] === (lastWall() as Wall).start[1])
    .toBe(true);
});

test("Ortho off: the same drag keeps its angle", async ({ page }) => {
  await start(page);
  const span = await groundSpan(page, 5000, 600);
  const [from, to] = [await screenOf(page, span.start), await screenOf(page, span.end)];
  if (!from || !to) throw new Error("the span is off screen");
  await page.keyboard.press("w");
  await drag(page, from, to);
  await page.mouse.up();
  await expect.poll(() => lastWall() !== undefined).toBe(true);
  const wall = lastWall() as Wall;
  expect(wall.end[1]).not.toBe(wall.start[1]);
});
