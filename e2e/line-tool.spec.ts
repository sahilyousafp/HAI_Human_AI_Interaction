import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import {
  handDraw,
  handEvent,
  handGestures,
  handTap,
  holdAt,
  openGround,
  type Point,
  references,
  releaseAt,
  run,
  viewerOf,
} from "./hands.ts";
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
  await page.keyboard.press("w");
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
  await expect(page.getByTestId("constraint-ortho")).toHaveAttribute("aria-pressed", "true");
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

// One pinch is one point. The fingers closing, a hand that drifts while they are closed and the other hand must not
// move the point, and the view must not orbit while one is being placed.
const draft = (page: Page) =>
  page.evaluate(() => {
    const tools = window.__HAI_TOOLS__?.getSnapshot() as unknown as {
      overlay: { draft: { points?: Array<[number, number, number]> } | null };
    };
    return tools.overlay.draft?.points ?? null;
  });

/** Where each hand's pointer is, as tracking reports it, at ground points; `closing` lists the hands pinching. */
async function pointers(
  page: Page,
  hands: { right?: Point | null; left?: Point | null },
  closing: { Right?: boolean; Left?: boolean } = {},
) {
  const place = async (at: Point | null | undefined) => {
    if (!at) return null;
    const view = await viewerOf(page, at);
    if (!view) throw new Error(`${at} is not on screen`);
    return page.evaluate(([x, y]) => window.__HAI_VIEWER__?.handAt(x, y) as Point, view);
  };
  const [right, left] = [await place(hands.right), await place(hands.left)];
  await page.evaluate(([r, l, c]) => window.__HAI_INPUT__?.pointer(r, l, c), [right, left, closing] as const);
}

/** Ortho off, whatever it was: these tests name exact points. */
async function freeAngles(page: Page) {
  const ortho = page.getByTestId("constraint-ortho");
  if ((await ortho.getAttribute("aria-pressed")) === "true") await ortho.click();
  await expect(ortho).toHaveAttribute("aria-pressed", "false");
}

/** A pinch-drag through ground points with real movement in it, as the recogniser sends one: an orbit would show. */
async function pinchDrag(page: Page, hand: "Left" | "Right", path: Point[]) {
  const positions: Point[] = [];
  for (const at of path) {
    const view = await viewerOf(page, at);
    if (!view) throw new Error(`${at} is not on screen`);
    positions.push(await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.handAt(x, y) as Point, view));
  }
  const ts = await page.evaluate(() => performance.now());
  const events = positions.map((position, i) => {
    const previous = positions[i - 1] ?? position;
    let type = "pinch.drag.update";
    if (i === 0) type = "pinch.drag.start";
    else if (i === positions.length - 1) type = "pinch.drag.end";
    return {
      type,
      ts: ts + i * 40,
      confidence: 1,
      hand,
      position,
      delta: [position[0] - previous[0], position[1] - previous[1]],
    };
  });
  await page.evaluate((e) => window.__HAI_INPUT__?.gestures(e as never), events);
}

const startByHand = async (page: Page) => {
  await start(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await page.keyboard.press("n");
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "line");
};

test("a pinch that drifts places one point where the preview was, and does not orbit", async ({ page }) => {
  await startByHand(page);
  await freeAngles(page);
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await pointers(page, { right: [x, y] });
  await handTap(page, [x, y], "Right");
  await pointers(page, { right: [x + 4000, y + 2000] });
  await expect.poll(() => draft(page).then((p) => p?.at(-1))).toEqual([x + 4000, y + 2000, 0]);
  const camera = await page.evaluate(() => JSON.stringify(window.__HAI_VIEWER__?.camera()));
  // The hand carries on moving while the fingers stay closed: the recogniser makes that a drag from where it began.
  await pinchDrag(page, "Right", [
    [x + 4000, y + 2000],
    [x + 5000, y + 3000],
    [x + 6000, y + 4000],
    [x + 6000, y + 4000],
  ]);
  expect(await page.evaluate(() => JSON.stringify(window.__HAI_VIEWER__?.camera()))).toBe(camera);
  await page.keyboard.press("Enter");
  await expect.poll(() => lines().length).toBe(1);
  expect(lines()[0]?.points).toEqual([
    [x, y, 0],
    [x + 4000, y + 2000, 0],
  ]);
});

test("while the fingers close the preview holds, and the pinch places what it showed", async ({ page }) => {
  await startByHand(page);
  await freeAngles(page);
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await pointers(page, { right: [x, y] });
  await handTap(page, [x, y], "Right");
  await pointers(page, { right: [x + 4000, y] });
  await expect.poll(() => draft(page).then((p) => p?.at(-1))).toEqual([x + 4000, y, 0]);
  // Closing thumb and finger dips the point between them: 300 mm on the ground here.
  await pointers(page, { right: [x + 4000, y - 300] }, { Right: true });
  await page.waitForTimeout(100);
  expect((await draft(page))?.at(-1)).toEqual([x + 4000, y, 0]);
  await handTap(page, [x + 4000, y - 300], "Right");
  await page.keyboard.press("Enter");
  await expect.poll(() => lines().length).toBe(1);
  expect(lines()[0]?.points.at(-1)).toEqual([x + 4000, y, 0]);
});

test("the hand that started the line steers it: the other hand neither moves it nor adds to it", async ({
  page,
}) => {
  await startByHand(page);
  await freeAngles(page);
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await pointers(page, { right: [x, y] });
  await handTap(page, [x, y], "Right");
  await pointers(page, { right: [x + 2000, y] });
  await expect.poll(() => draft(page).then((p) => p?.at(-1))).toEqual([x + 2000, y, 0]);
  // The drawing hand drops out for a moment: the pointer falls to the other hand, which must not take the line.
  await pointers(page, { left: [x + 5000, y + 3000] });
  await page.waitForTimeout(100);
  expect((await draft(page))?.at(-1)).toEqual([x + 2000, y, 0]);
  // The other hand's drag still orbits, and the drawing hand keeps steering while that hand has the focus.
  const before = await page.evaluate(() => JSON.stringify(window.__HAI_VIEWER__?.camera()));
  await pinchDrag(page, "Left", [
    [x + 5000, y + 3000],
    [x + 4000, y + 3000],
    [x + 3000, y + 3000],
    [x + 3000, y + 3000],
  ]);
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.__HAI_VIEWER__?.camera())))
    .not.toBe(before);
  // The orbit coasts for a moment, which moves the ground under a pointer: keep pointing until the view settles.
  await expect
    .poll(async () => {
      await pointers(page, { right: [x + 3000, y], left: [x + 1000, y + 3000] });
      return draft(page).then((p) => p?.at(-1)?.slice(0, 2));
    })
    .toEqual([x + 3000, y]);
});

test("a long pinch during a line still opens the ring, and places no point", async ({ page }) => {
  await startByHand(page);
  await freeAngles(page);
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await pointers(page, { right: [x, y] });
  await handTap(page, [x, y], "Right");
  const at = await viewerOf(page, [x + 3000, y]);
  if (!at) throw new Error("not on screen");
  await holdAt(page, at, "Right");
  await expect(page.getByTestId("tool-palette")).toBeAttached();
  await releaseAt(page, at, "Right");
  await expect(page.getByTestId("tool-palette")).toHaveCount(0);
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "line");
  await page.keyboard.press("Enter");
  expect(lines()).toHaveLength(0); // one point only: the hold added nothing to finish
});

test("Line locks to angles from the start, and Wall keeps its own setting", async ({ page }) => {
  await start(page);
  await page.keyboard.press("n");
  const ortho = page.getByTestId("constraint-ortho");
  await expect(ortho).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("w");
  await expect(ortho).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("n");
  await expect(ortho).toHaveAttribute("aria-pressed", "true");
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await click(page, [x, y]);
  await click(page, [x + 5000, y + 1000]); // 11 degrees off the X axis: the 45 degree step holds it on the axis
  await page.keyboard.press("Enter");
  await expect.poll(() => lines().length).toBe(1);
  const [a, b] = lines()[0]?.points ?? [];
  expect(b?.[1]).toBe(a?.[1]);
});

// A line can be put right: while it is drawn, and after it is placed.
const elementsDraft = async (page: Page) => (await draft(page))?.length ?? 0;

test("undo while drawing takes back the line's last point, however it is asked for, and never the model", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("n");
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  // A line already in the model, which an undo meant for the new line must not take.
  await click(page, [x, y]);
  await click(page, [x + 4000, y]);
  await page.keyboard.press("Enter");
  await expect.poll(() => lines().length).toBe(1);

  await click(page, [x, y + 2000]);
  await click(page, [x + 2000, y + 2000]);
  await click(page, [x + 4000, y + 2000]);
  await expect.poll(() => elementsDraft(page)).toBe(3);

  await page.keyboard.press("Control+z");
  await expect.poll(() => elementsDraft(page)).toBe(2);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => elementsDraft(page)).toBe(3);
  await page.keyboard.press("u");
  await expect.poll(() => elementsDraft(page)).toBe(2);
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect.poll(() => elementsDraft(page)).toBe(0); // one point left: not a line to draw yet
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("line-undo-point")).toBeDisabled(); // nothing left of the new line
  expect(lines()).toHaveLength(1);
  await page.keyboard.press("Control+z"); // now it is the model's turn
  await expect.poll(() => lines().length).toBe(0);
});

test("the panel's Undo point and Finish do the same, and are there for a hand", async ({ page }) => {
  await start(page);
  await page.keyboard.press("n");
  const undo = page.getByTestId("line-undo-point");
  const finish = page.getByTestId("line-finish");
  await expect(undo).toBeDisabled();
  await expect(finish).toBeDisabled();
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await click(page, [x, y]);
  await expect(undo).toBeEnabled();
  await expect(finish).toBeDisabled(); // one point is not a line
  await click(page, [x + 2000, y]);
  await click(page, [x + 4000, y]);
  await expect(finish).toBeEnabled();
  await undo.click();
  await expect.poll(() => elementsDraft(page)).toBe(2);
  await expect(undo).toHaveAttribute("data-hand-press");
  await finish.click();
  await expect.poll(() => lines().length).toBe(1);
  expect(lines()[0]?.points).toHaveLength(2);
});

test("a sketch can be undone and redone while its tool is active, and the model is left alone", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("n");
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await click(page, [x, y]);
  await click(page, [x + 4000, y]);
  await page.keyboard.press("Enter");
  await expect.poll(() => lines().length).toBe(1);
  await page.keyboard.press("l");
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await handDraw(page, run([x, y + 1000], [x + 3000, y + 1000]), "Right");
  await expect.poll(() => references(page).then((r) => r.sketches.length)).toBe(1);
  await page.keyboard.press("Control+z");
  await expect.poll(() => references(page).then((r) => r.sketches.length)).toBe(0);
  expect(lines()).toHaveLength(1);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => references(page).then((r) => r.sketches.map((s) => s.label))).toEqual(["S1"]);
});

/** A finished three-point line; its id and where its points are. */
async function drawnLine(page: Page) {
  await page.keyboard.press("n");
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  const path: Point[] = [
    [x, y],
    [x + 4000, y],
    [x + 4000, y + 4000],
  ];
  for (const at of path) await click(page, at);
  await page.keyboard.press("Enter");
  await expect.poll(() => lines().length).toBe(1);
  const id = Object.values(bridge?.scene.scene.doc.elements ?? {}).find((e) => e.type === "line")?.id ?? "";
  return { id, path, x, y };
}

const selected = (page: Page) =>
  page.evaluate(() => (window.__HAI_SCENE__?.getSnapshot().selection ?? []) as string[]);

test("a finished line is picked within a finger's reach, however thin it is drawn", async ({ page }) => {
  await start(page);
  const { id, x, y } = await drawnLine(page);
  await page.keyboard.press("v");
  const [px, py] = await onPage(page, [x + 2000, y]);
  await page.mouse.click(px, py + 8); // 8 px off the line
  await expect.poll(() => selected(page)).toEqual([id]);
  await page.mouse.click(px, py + 60); // well away from it
  await expect.poll(() => selected(page)).toEqual([]);
});

test("Move shows a line's points, and drags one as a single undo step", async ({ page }) => {
  await start(page);
  const { path, x, y } = await drawnLine(page);
  await expect(page.getByTestId("line-handle")).toHaveCount(0);
  await page.keyboard.press("m");
  await expect(page.getByTestId("line-handle")).toHaveCount(3);
  const [fx, fy] = await onPage(page, path[1] as Point);
  const [tx, ty] = await onPage(page, [x + 5000, y + 1000]);
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move((fx + tx) / 2, (fy + ty) / 2, { steps: 3 });
  await page.mouse.move(tx, ty, { steps: 3 });
  await page.mouse.up();
  await expect.poll(() => lines()[0]?.points[1]).toEqual([x + 5000, y + 1000, 0]);
  expect(lines()[0]?.points[0]).toEqual([x, y, 0]);
  expect(lines()[0]?.points[2]).toEqual([x + 4000, y + 4000, 0]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => lines()[0]?.points[1]).toEqual([x + 4000, y, 0]);
});

test("a hand moves a point with Move too, and a pinch along the span moves the whole line", async ({
  page,
}) => {
  await start(page);
  const { x, y } = await drawnLine(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await page.keyboard.press("m");
  await handGestures(page, "Right", [
    { type: "pinch.drag.start", at: [x, y] },
    { type: "pinch.drag.update", at: [x, y + 1000] },
    { type: "pinch.drag.end", at: [x, y + 1000] },
  ]);
  await expect.poll(() => lines()[0]?.points[0]).toEqual([x, y + 1000, 0]);
  expect(lines()[0]?.points[1]).toEqual([x + 4000, y, 0]);
  await handGestures(page, "Right", [
    { type: "pinch.drag.start", at: [x + 4000, y + 2000] },
    { type: "pinch.drag.update", at: [x + 4500, y + 2000] },
    { type: "pinch.drag.end", at: [x + 4500, y + 2000] },
  ]);
  await expect.poll(() => lines()[0]?.points[1]).toEqual([x + 4500, y, 0]);
  expect(lines()[0]?.points[0]).toEqual([x + 500, y + 1000, 0]);
});

test("Delete removes one point of a line, or the whole line from its span, and both undo", async ({
  page,
}) => {
  await start(page);
  const { path, x, y } = await drawnLine(page);
  await page.keyboard.press("x");
  await expect(page.getByTestId("line-handle")).toHaveCount(3);
  await click(page, path[1] as Point);
  await expect.poll(() => lines()[0]?.points.length).toBe(2);
  expect(lines()[0]?.points).toEqual([
    [x, y, 0],
    [x + 4000, y + 4000, 0],
  ]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => lines()[0]?.points.length).toBe(3);
  await click(page, [x + 2000, y]); // on the span, away from every point
  await expect(page.getByTestId("tool-question")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(() => lines().length).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(() => lines().length).toBe(1);
});

test("a line of two points asks before its last span goes, and a closed line of three opens", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("n");
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await click(page, [x, y]);
  await click(page, [x + 4000, y]);
  await click(page, [x + 4000, y + 4000]);
  await click(page, [x, y]); // the first point again: closed
  await expect.poll(() => lines()[0]?.closed).toBe(true);
  await page.keyboard.press("x");
  await click(page, [x + 4000, y + 4000]);
  await expect.poll(() => lines()[0]?.closed).toBe(false);
  expect(lines()[0]?.points).toHaveLength(2);
  await click(page, [x + 4000, y]);
  await expect(page.getByTestId("tool-question")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(lines()).toHaveLength(1);
});

test("Line is one tool with a Straight and Freeform toggle: a drag traces one real model line", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("n");
  const straight = page.getByTestId("line-mode-straight");
  const freeform = page.getByTestId("line-mode-freeform");
  await expect(straight).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("constraint-ortho")).toBeVisible();
  await freeform.click();
  await expect(freeform).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("constraint-ortho")).toHaveCount(0); // neither angles nor a length apply to a trace
  await expect(page.getByTestId("constraint-length")).toHaveCount(0);
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "line");

  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  const curve: Point[] = Array.from({ length: 13 }, (_, i) => [
    x + i * 500,
    y + 2000 + 1500 * Math.sin((i / 12) * Math.PI * 2),
  ]);
  const camera = await page.evaluate(() => JSON.stringify(window.__HAI_VIEWER__?.camera()));
  const [first, ...rest] = curve as [Point, ...Point[]];
  const start_ = await onPage(page, first);
  await page.mouse.move(start_[0], start_[1]);
  await page.mouse.down();
  for (const at of rest) {
    const [px, py] = await onPage(page, at);
    await page.mouse.move(px, py, { steps: 2 });
  }
  await page.mouse.up();
  await expect.poll(() => lines().length).toBe(1);
  const [line] = lines();
  expect(line?.points.length).toBeGreaterThan(4); // a curve, not two ends
  // Free of the 100 mm grid: at least one point is not on it.
  expect(line?.points.some(([, py]) => py % 100 !== 0)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(window.__HAI_VIEWER__?.camera()))).toBe(camera);
  await page.keyboard.press("Control+z");
  await expect.poll(() => lines().length).toBe(0);
  // Back to Straight, the angle lock returns.
  await straight.click();
  await expect(page.getByTestId("constraint-ortho")).toBeVisible();
});

test("the toggle works by hand, and a hand's drag traces in Freeform", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await page.keyboard.press("n");
  const box = await page.getByTestId("line-mode-freeform").boundingBox();
  const canvas = await page.locator("[data-testid=viewer] canvas").boundingBox();
  if (!box || !canvas) throw new Error("no toggle");
  const at: Point = [
    (box.x + box.width / 2 - canvas.x) / canvas.width,
    (box.y + box.height / 2 - canvas.y) / canvas.height,
  ];
  await handEvent(page, "Right", "pinch.tap", at);
  await expect(page.getByTestId("line-mode-freeform")).toHaveAttribute("aria-checked", "true");
  const [x, y] = await openGround(page, 6000, 4000, { empty: true });
  await handDraw(page, run([x, y], [x + 4000, y + 2000]), "Right");
  await expect.poll(() => lines().length).toBe(1);
});
