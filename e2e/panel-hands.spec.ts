import { expect, type Page, test } from "@playwright/test";
import {
  box,
  committedColumnX,
  frame,
  openClearancePanel,
  openCustomPanel,
  shell,
  shownColumnX,
  start,
  stopBridge,
} from "./panel-support.ts";
import { handAt } from "./viewer.ts";

// Both hands work inside a panel: a pinch presses the control under the pointer, and a pinch-drag moves a slider as a
// mouse does. The hand input is injected into the same bus the tracker feeds.

test.afterEach(stopBridge);

type Point = [number, number];
const COLUMN = 4000;

/** The pinch point (camera frame) that puts a hand's pointer on a point of the page, in client pixels. */
async function pinchAtClient(page: Page, [x, y]: Point): Promise<Point> {
  const viewer = await box(page.getByTestId("viewer"));
  return handAt(page, [(x - viewer.x) / viewer.width, (y - viewer.y) / viewer.height]);
}

const pointer = (page: Page, right: Point | null, closing = false) =>
  page.evaluate(([r, c]) => window.__HAI_INPUT__?.pointer(r, null, c ? { Right: true } : undefined), [
    right,
    closing,
  ] as const);

const gesture = (page: Page, type: string, position: Point) =>
  page.evaluate((e) => window.__HAI_INPUT__?.gestures([{ confidence: 1, delta: [0, 0], ...e } as never]), {
    type,
    hand: "Right",
    position,
    ts: Date.now(),
  });

/** The middle of a locator, in client pixels. */
async function centre(locator: ReturnType<Page["locator"]>): Promise<Point> {
  const b = await box(locator);
  return [b.x + b.width / 2, b.y + b.height / 2];
}

/** A quick pinch (a tap) with the right hand at a point of the page. */
async function tapAt(page: Page, at: Point) {
  const position = await pinchAtClient(page, at);
  await pointer(page, position);
  await page.waitForTimeout(60);
  await gesture(page, "pinch.tap", position);
}

/** A pinch held while the hand moves from one point of the page to another, then let go. */
async function dragBetween(page: Page, from: Point, to: Point, steps = 8) {
  const start = await pinchAtClient(page, from);
  await pointer(page, start);
  await page.waitForTimeout(60);
  await pointer(page, start, true);
  await gesture(page, "pinch.drag.start", start);
  for (let i = 1; i <= steps; i++) {
    const p = await pinchAtClient(page, [from[0] + ((to[0] - from[0]) * i) / steps, from[1]]);
    await pointer(page, p, true);
    await gesture(page, "pinch.drag.update", p);
    await page.waitForTimeout(20);
  }
  const end = await pinchAtClient(page, to);
  await gesture(page, "pinch.drag.end", end);
  await pointer(page, end);
}

test.describe("controls inside the panel", () => {
  test("Press a button inside the panel: the button's action runs", async ({ page }) => {
    await start(page);
    await openCustomPanel(
      page,
      `<output id="v">0</output> mm <button id="set150" type="button">Set 150 mm</button><script>
        document.getElementById("set150").addEventListener("click", () => { document.getElementById("v").textContent = "150"; });
      </script>`,
    );
    await tapAt(page, await centre(frame(page).locator("#set150")));
    await expect(frame(page).locator("#v")).toHaveText("150");
  });

  test("a checkbox and a radio button are toggled by a pinch", async ({ page }) => {
    await start(page);
    await openCustomPanel(
      page,
      `<label><input id="c" type="checkbox"> Keep clearance</label>
       <label><input id="r1" type="radio" name="m" checked> Metric</label>
       <label><input id="r2" type="radio" name="m"> Imperial</label>`,
    );
    await tapAt(page, await centre(frame(page).locator("#c")));
    await expect(frame(page).locator("#c")).toBeChecked();
    await tapAt(page, await centre(frame(page).locator("#c")));
    await expect(frame(page).locator("#c")).not.toBeChecked();
    await tapAt(page, await centre(frame(page).locator("#r2")));
    await expect(frame(page).locator("#r2")).toBeChecked();
    await expect(frame(page).locator("#r1")).not.toBeChecked();
  });

  test("a pinch on a disabled button does nothing", async ({ page }) => {
    await start(page);
    await openCustomPanel(
      page,
      `<output id="v">0</output><button id="off" type="button" disabled>Off</button><script>
        document.getElementById("off").addEventListener("click", () => { document.getElementById("v").textContent = "pressed"; });
      </script>`,
    );
    await tapAt(page, await centre(frame(page).locator("#off")));
    await page.waitForTimeout(200);
    await expect(frame(page).locator("#v")).toHaveText("0");
  });

  test("a hand-dragged range moves like a mouse-dragged one", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    const slider = frame(page).locator("#s");
    const b = await box(slider);
    const y = b.y + b.height / 2;
    const from: Point = [b.x + b.width * 0.2, y];
    const to: Point = [b.x + b.width * 0.8, y];

    // By mouse.
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(to[0], to[1], { steps: 8 });
    await page.mouse.up();
    const byMouse = await slider.inputValue();
    expect(Number(byMouse)).toBeGreaterThan(250);

    // By hand, from the same start to the same end, after putting the slider back.
    await slider.fill("100");
    await expect(frame(page).locator("#v")).toHaveText("100");
    await dragBetween(page, from, to);
    await expect(slider).toHaveValue(byMouse);
    // The model followed it, in the viewer only.
    await expect.poll(() => shownColumnX(page)).toBe(COLUMN + Number(byMouse) - 150);
    expect(committedColumnX()).toBe(COLUMN);
  });

  test("a pinch on the track of a range sets it there, as a click does", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    const slider = frame(page).locator("#s");
    const b = await box(slider);
    await tapAt(page, [b.x + b.width * 0.5, b.y + b.height / 2]);
    // Halfway along 50 to 400 in steps of 10.
    await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThanOrEqual(220);
    expect(Number(await slider.inputValue())).toBeLessThanOrEqual(230);
  });
});

test.describe("the panel's own controls", () => {
  test("Press Close by hand: the panel closes and the model is back", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await page.waitForTimeout(100);
    await frame(page).locator("#s").fill("300");
    await expect.poll(() => shownColumnX(page)).toBe(COLUMN + 150);
    await tapAt(page, await centre(shell(page).getByTestId("panel-close")));
    await expect(shell(page)).toHaveCount(0);
    expect(await shownColumnX(page)).toBe(COLUMN);
  });

  test("Press Done by hand: the result is kept", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await frame(page).locator("#s").fill("200");
    await expect.poll(() => shownColumnX(page)).toBe(COLUMN + 50);
    await tapAt(page, await centre(shell(page).getByTestId("panel-done")));
    await expect(shell(page)).toHaveCount(0);
    await expect.poll(() => committedColumnX()).toBe(COLUMN + 50);
  });
});

test.describe("closing from the keyboard", () => {
  test("Close with Escape while the panel's own content has focus", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await frame(page).locator("#s").fill("300");
    await expect.poll(() => shownColumnX(page)).toBe(COLUMN + 150);
    await frame(page).locator("#s").focus();
    await page.keyboard.press("Escape");
    await expect(shell(page)).toHaveCount(0);
    expect(await shownColumnX(page)).toBe(COLUMN);
    expect(committedColumnX()).toBe(COLUMN);
  });

  test("Close with Escape while the panel's header or buttons have focus", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await shell(page).getByTestId("panel-done").focus();
    await page.keyboard.press("Escape");
    await expect(shell(page)).toHaveCount(0);
  });
});
