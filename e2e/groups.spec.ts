import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { handEvent, openGround, type Point, viewerOf } from "./hands.ts";
import { modelArrived, openViewer, startTestBridge } from "./viewer.ts";

// A selection holds together: tapping one member of a group means all of it, and every tool acts on the whole. The
// options card pinned to it does the same, one press away.
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

type Column = { type: "column"; id: string; position: [number, number]; tags?: Record<string, string> };

/** Where the test's columns start, millimetres, on open ground in view: three in a group and one on its own. */
let POSITIONS: Record<string, Point> = {};
/** What the sample model held before the test's columns, which no test touches. */
let sample = new Set<string>();

const elements = () =>
  (Object.values(bridge?.scene.scene.doc.elements ?? {}) as unknown as Column[]).filter(
    (e) => !sample.has(e.id),
  );
const grouped = () => elements().filter((e) => e.tags?.["hai.group"]);
const byId = (id: string) => elements().find((e) => e.id === id);

const selection = (page: Page) =>
  page.evaluate(() => [...(window.__HAI_SCENE__?.getSnapshot().selection ?? [])].sort());

async function start(page: Page, grouping: "group" | "none" = "group") {
  await page.setViewportSize({ width: 1440, height: 900 });
  bridge = await startTestBridge(page);
  await openViewer(page);
  sample = new Set(Object.keys(bridge.scene.scene.doc.elements));
  const [x, y] = await openGround(page, 10_000, 6000, { empty: true });
  POSITIONS = {
    a: [x + 2000, y + 1000],
    b: [x + 6000, y + 1000],
    c: [x + 4000, y + 4000],
    alone: [x + 9500, y + 500],
  };
  const ops = Object.entries(POSITIONS).map(([id, position]) => ({
    op: "create",
    element: {
      id,
      name: id,
      type: "column",
      properties: {},
      position,
      section: [800, 800],
      height: 3000,
      ...(grouping === "group" && id !== "alone" ? { tags: { "hai.group": "group-test" } } : {}),
    },
  }));
  await page.evaluate((o) => window.__HAI_SCENE__?.apply("Columns", o as never), ops);
  await expect.poll(() => byId("alone")?.id).toBe("alone");
  await modelArrived(page, bridge);
}

/** Where a point on a column is on the page, px: partway up it, so the pointer meets the column. */
async function onColumn(page: Page, id: string): Promise<Point> {
  await modelArrived(page, bridge as Bridge);
  const [x, y] = byId(id)?.position ?? [0, 0];
  const view = await page.evaluate(([a, b]) => window.__HAI_VIEWER__?.project([a, b, 1500]), [x, y] as const);
  const box = await page.locator("[data-testid=viewer] canvas").boundingBox();
  if (!view || !box) throw new Error(`${id} is not on screen`);
  return [box.x + view[0] * box.width, box.y + view[1] * box.height];
}

/** Where a ground point is on the page, px. */
async function onGround(page: Page, at: Point): Promise<Point> {
  await modelArrived(page, bridge as Bridge);
  const view = await viewerOf(page, at);
  const box = await page.locator("[data-testid=viewer] canvas").boundingBox();
  if (!view || !box) throw new Error(`${at} is not clear on screen`);
  return [box.x + view[0] * box.width, box.y + view[1] * box.height];
}

async function dragOver(page: Page, from: Point, ...through: Point[]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (const [x, y] of through) await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.up();
}

const undo = (page: Page) => page.keyboard.press("Control+z");

test("tapping one member selects the whole group, and the status bar says so", async ({ page }) => {
  await start(page);
  const [x, y] = await onColumn(page, "b");
  await page.mouse.click(x, y);
  await expect.poll(() => selection(page)).toEqual(["a", "b", "c"]);
  await expect(page.getByTestId("selection-status")).toHaveText("Group of 3");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__HAI_SCENE__?.select(["alone"]));
  await expect.poll(() => selection(page)).toEqual(["alone"]);
  await expect(page.getByTestId("selection-status")).toHaveText("alone (column)");
});

test("Move carries the whole group from any member, as one undo step, and leaves the rest", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("m");
  const from = await onColumn(page, "a");
  await dragOver(page, from, [from[0] + 60, from[1]]);
  await expect.poll(() => byId("a")?.position).not.toEqual(POSITIONS.a);
  const moved = (id: string) => (byId(id)?.position[0] ?? 0) - (POSITIONS[id]?.[0] ?? 0);
  expect(moved("b")).toBe(moved("a"));
  expect(moved("c")).toBe(moved("a"));
  expect(moved("alone")).toBe(0);
  await undo(page);
  await expect.poll(() => byId("c")?.position).toEqual(POSITIONS.c);
  expect(byId("a")?.position).toEqual(POSITIONS.a);
});

test("Copy copies the whole group, and the copies are a group of their own", async ({ page }) => {
  await start(page);
  await page.keyboard.press("p");
  const from = await onColumn(page, "b");
  await dragOver(page, from, [from[0] + 60, from[1] + 40]);
  await expect.poll(() => elements().length).toBe(7);
  const copies = elements().filter((e) => !POSITIONS[e.id]);
  expect(copies).toHaveLength(3);
  const group = copies[0]?.tags?.["hai.group"];
  expect(group).toBeTruthy();
  expect(group).not.toBe("group-test");
  expect(copies.every((c) => c.tags?.["hai.group"] === group)).toBe(true);
  await undo(page);
  await expect.poll(() => elements().length).toBe(4);
});

test("Copy carries a selection that is not a group, and its copies are not grouped either", async ({
  page,
}) => {
  await start(page, "none");
  await page.evaluate(() => window.__HAI_SCENE__?.select(["a", "b"]));
  await page.keyboard.press("p");
  const from = await onColumn(page, "a");
  await dragOver(page, from, [from[0] + 60, from[1] + 40]);
  await expect.poll(() => elements().length).toBe(6);
  expect(grouped()).toHaveLength(0);
});

test("Delete asks once for the whole group, and one undo brings all of it back", async ({ page }) => {
  await start(page);
  await page.keyboard.press("x");
  const [x, y] = await onColumn(page, "c");
  await page.mouse.click(x, y);
  await expect(page.getByTestId("tool-question")).toContainText("group of 3");
  await page.keyboard.press("Enter");
  await expect.poll(() => elements().map((e) => e.id)).toEqual(["alone"]);
  await undo(page);
  await expect.poll(() => elements().length).toBe(4);
});

test("Delete takes a selection that is not a group as a whole too", async ({ page }) => {
  await start(page, "none");
  await page.evaluate(() => window.__HAI_SCENE__?.select(["a", "b"]));
  await page.keyboard.press("x");
  const [x, y] = await onColumn(page, "a");
  await page.mouse.click(x, y);
  await expect(page.getByTestId("tool-question")).toContainText("2 elements");
  await page.keyboard.press("Enter");
  await expect.poll(() => elements().length).toBe(2);
});

test("Rotate turns the whole group about its centre as one body, in one undo step", async ({ page }) => {
  await start(page);
  await page.keyboard.press("o");
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "rotate");
  const distance = (p: string, q: string) => {
    const [ax, ay] = byId(p)?.position ?? [0, 0];
    const [bx, by] = byId(q)?.position ?? [0, 0];
    return Math.hypot(ax - bx, ay - by);
  };
  const [ab, ac] = [distance("a", "b"), distance("a", "c")];
  const [ax = 0, ay = 0] = POSITIONS.a ?? [];
  const [bx = 0] = POSITIONS.b ?? [];
  const [, cy = 0] = POSITIONS.c ?? [];
  // A turn round the middle of the three columns' box, starting at a.
  const centre: Point = [(ax + bx) / 2, (ay + cy) / 2];
  const on = (angle: number): Point => [
    centre[0] + 2500 * Math.cos((angle * Math.PI) / 180),
    centre[1] + 2500 * Math.sin((angle * Math.PI) / 180),
  ];
  const from = await onColumn(page, "a");
  const path: Point[] = [];
  for (const angle of [-150, -130, -110, -90, -70]) path.push(await onGround(page, on(angle)));
  await dragOver(page, from, ...path);
  await expect.poll(() => byId("a")?.position).not.toEqual(POSITIONS.a);
  expect(distance("a", "b")).toBeCloseTo(ab, 0);
  expect(distance("a", "c")).toBeCloseTo(ac, 0);
  expect(byId("alone")?.position).toEqual(POSITIONS.alone);
  await undo(page);
  await expect.poll(() => byId("a")?.position).toEqual(POSITIONS.a);
  expect(byId("b")?.position).toEqual(POSITIONS.b);
});

test("Rotate with nothing under the drag and nothing selected orbits", async ({ page }) => {
  await start(page);
  await page.keyboard.press("o");
  const camera = () => page.evaluate(() => JSON.stringify(window.__HAI_VIEWER__?.camera()));
  const before = await camera();
  const [x = 0, y = 0] = POSITIONS.c ?? [];
  const open = await onGround(page, [x + 1500, y + 1500]);
  await dragOver(page, open, [open[0] + 60, open[1]]);
  await expect.poll(camera).not.toBe(before);
  expect(byId("a")?.position).toEqual(POSITIONS.a);
});

test("a lasso that catches part of a group selects all of it", async ({ page }) => {
  await start(page);
  const at = await onColumn(page, "a");
  await page.keyboard.press("g");
  await dragOver(
    page,
    [at[0] - 40, at[1] - 40],
    [at[0] + 40, at[1] - 40],
    [at[0] + 40, at[1] + 40],
    [at[0] - 40, at[1] + 40],
    [at[0] - 40, at[1] - 40],
  );
  await expect.poll(() => selection(page)).toEqual(["a", "b", "c"]);
});

// The options card pinned to what is selected.
const card = (page: Page) => page.getByTestId("selection-panel");

async function selectGroup(page: Page) {
  const [x, y] = await onColumn(page, "b");
  await page.mouse.click(x, y);
  await expect(card(page)).toBeVisible();
}

test("the card names the group and its id, and one press on Ungroup is one undo step", async ({ page }) => {
  await start(page);
  await expect(card(page)).toHaveCount(0);
  await selectGroup(page);
  await expect(page.getByTestId("selection-title")).toHaveText("Group of 3");
  await expect(page.getByTestId("selection-detail")).toHaveText("group-test");
  await page.getByTestId("selection-ungroup").click();
  await expect.poll(() => grouped().length).toBe(0);
  // Still selected, and now it can be grouped again.
  await expect(page.getByTestId("selection-title")).toHaveText("3 selected");
  await expect(page.getByTestId("selection-detail")).toHaveText("not grouped");
  await expect(page.getByTestId("selection-ungroup")).toHaveCount(0);
  await undo(page);
  await expect.poll(() => grouped().length).toBe(3);
});

test("the card groups several, and a single element has neither Group nor Ungroup", async ({ page }) => {
  await start(page, "none");
  await page.evaluate(() => window.__HAI_SCENE__?.select(["a", "b"]));
  await page.getByTestId("selection-group").click();
  await expect
    .poll(() =>
      grouped()
        .map((e) => e.id)
        .sort(),
    )
    .toEqual(["a", "b"]);
  await expect(page.getByTestId("selection-title")).toHaveText("Group of 2");
  await page.evaluate(() => window.__HAI_SCENE__?.select(["alone"]));
  await expect(page.getByTestId("selection-title")).toHaveText("alone");
  await expect(page.getByTestId("selection-detail")).toHaveText("column");
  await expect(page.getByTestId("selection-group")).toHaveCount(0);
  await expect(page.getByTestId("selection-ungroup")).toHaveCount(0);
});

test("the card's buttons do what they say, and it goes when another tool is active", async ({ page }) => {
  await start(page);
  await selectGroup(page);
  await page.getByTestId("selection-rotate").click();
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "rotate");
  await expect(card(page)).toHaveCount(0);
  await page.keyboard.press("v");
  await page.getByTestId("selection-move").click();
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "move");
  await page.keyboard.press("v");
  await page.getByTestId("selection-copy").click();
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "copy");
  await page.keyboard.press("v");
  await page.getByTestId("selection-delete").click();
  await expect(page.getByTestId("tool-question")).toContainText("group of 3");
  await page.keyboard.press("Escape");
  expect(elements()).toHaveLength(4);
  await page.getByTestId("selection-hide").click();
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => selection(page)).toEqual([]);
});

test("a hand presses the card, and the model under it is not picked through it", async ({ page }) => {
  await start(page);
  await selectGroup(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  const box = await page.getByTestId("selection-ungroup").boundingBox();
  const canvas = await page.locator("[data-testid=viewer] canvas").boundingBox();
  if (!box || !canvas) throw new Error("no button");
  const at: Point = [
    (box.x + box.width / 2 - canvas.x) / canvas.width,
    (box.y + box.height / 2 - canvas.y) / canvas.height,
  ];
  expect(await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x, y), at)).toBeNull();
  await handEvent(page, "Right", "pinch.tap", at);
  await expect.poll(() => grouped().length).toBe(0);
});

test("the card follows the camera and keeps to the view", async ({ page }) => {
  await start(page);
  await selectGroup(page);
  const before = await card(page).boundingBox();
  const [x = 0, y = 0] = POSITIONS.c ?? [];
  const open = await onGround(page, [x + 1500, y + 1500]);
  await dragOver(page, open, [open[0] + 200, open[1]]);
  await expect
    .poll(async () => JSON.stringify(await card(page).boundingBox()))
    .not.toBe(JSON.stringify(before));
  const box = await card(page).boundingBox();
  const view = await page.locator("[data-testid=viewer] canvas").boundingBox();
  if (!box || !view) throw new Error("no card");
  expect(box.x).toBeGreaterThanOrEqual(view.x);
  expect(box.y).toBeGreaterThanOrEqual(view.y);
  expect(box.x + box.width).toBeLessThanOrEqual(view.x + view.width);
  expect(box.y + box.height).toBeLessThanOrEqual(view.y + view.height);
});

for (const size of [
  { width: 1280, height: 720 },
  { width: 1024, height: 640 },
  { width: 900, height: 600 },
]) {
  test(`the card covers no other panel at ${size.width} px`, async ({ page }) => {
    await start(page);
    await page.setViewportSize(size);
    await page.evaluate(() => window.__HAI_SCENE__?.select(["a"]));
    await expect(card(page)).toBeVisible();
    await page.waitForTimeout(100);
    const overlaps = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="selection-panel"]')?.getBoundingClientRect();
      if (!box) return ["no card"];
      const others = {
        "project bar": ".viewer-toolbar",
        "view cube": ".view-cube-box",
        "status bar": ".viewer-status",
        "camera view": ".camera-view",
      };
      return Object.entries(others).flatMap(([name, selector]) => {
        const b = document.querySelector(selector)?.getBoundingClientRect();
        if (!b) return [];
        const across = Math.min(box.right, b.right) - Math.max(box.left, b.left);
        const down = Math.min(box.bottom, b.bottom) - Math.max(box.top, b.top);
        return across > 0 && down > 0 ? [name] : [];
      });
    });
    expect(overlaps).toEqual([]);
  });
}

// A preview stays until its change arrives. Undo brings the model back to what the preview was made from, so a preview
// left behind would come alive again, and the model would be drawn where it is not.
const pickAt = async (page: Page, at: Point) => {
  const box = await page.locator("[data-testid=viewer] canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  return page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x, y), [
    (at[0] - box.x) / box.width,
    (at[1] - box.y) / box.height,
  ] as const);
};

test("after Move and an undo the model is drawn where it is, with no old preview on it", async ({ page }) => {
  await start(page);
  await page.keyboard.press("m");
  const from = await onColumn(page, "alone");
  await dragOver(page, from, [from[0] - 120, from[1]]);
  await expect.poll(() => byId("alone")?.position).not.toEqual(POSITIONS.alone);
  await undo(page);
  await expect.poll(() => byId("alone")?.position).toEqual(POSITIONS.alone);
  await expect.poll(() => pickAt(page, from)).toBe("alone");
});

test("after Rotate and an undo the model is drawn where it is, with no old drafts on it", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("o");
  const from = await onColumn(page, "a");
  const [cx = 0, cy = 0] = POSITIONS.c ?? [];
  const through = await onGround(page, [cx, cy - 3500]);
  await dragOver(page, from, through);
  await expect.poll(() => byId("a")?.position).not.toEqual(POSITIONS.a);
  await undo(page);
  await expect.poll(() => byId("a")?.position).toEqual(POSITIONS.a);
  await expect.poll(() => pickAt(page, from)).toBe("a");
  expect(
    await page.evaluate(() => {
      const tools = window.__HAI_TOOLS__?.getSnapshot() as unknown as { overlay: { drafts: unknown[] } };
      return tools.overlay.drafts.length;
    }),
  ).toBe(0);
});
