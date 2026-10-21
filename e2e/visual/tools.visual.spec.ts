import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../../apps/bridge/src/server.ts";
import { handAt, openViewer, startTestBridge } from "../viewer.ts";

let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

/** Waits until the view has stopped drawing (the camera eased into place), so screenshots are stable. */
async function settled(page: Page) {
  const renders = () => page.evaluate(() => window.__AEX_VIEWER__?.renders() ?? 0);
  let last = -1;
  await expect
    .poll(
      async () => {
        const now = await renders();
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [300] },
    )
    .toBe(true);
}

for (const scheme of ["light", "dark"] as const) {
  test(`open palette (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    bridge = await startTestBridge(page);
    await openViewer(page);
    await settled(page);
    const box = await page.getByTestId("viewer").boundingBox();
    if (!box) throw new Error("viewer not laid out");
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await page.keyboard.down(" ");
    await page.mouse.move(box.x + box.width * 0.45 + 80, box.y + box.height * 0.5 + 2, { steps: 3 });
    const palette = page.getByTestId("tool-palette");
    await expect(page.getByTestId("palette-slot-2")).toHaveAttribute("data-highlighted", "true");
    await expect(palette).toHaveScreenshot(`palette-${scheme}.png`);
    await page.keyboard.up(" ");
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`the left hand's create ring (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    bridge = await startTestBridge(page);
    await openViewer(page);
    await settled(page);
    await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
    const centre = await handAt(page, [0.6, 0.5]);
    const send = (type: string, position: [number, number]) =>
      page.evaluate(
        (e) =>
          window.__AEX_INPUT__?.gestures([{ confidence: 1, delta: [0, 0], hand: "Left", ...e } as never]),
        { type, position, ts: Date.now() },
      );
    await send("pinch.drag.start", centre);
    await send("pinch.hold", centre);
    await send("pinch.drag.update", [centre[0] + 0.08, centre[1]]); // toward Column, on the right
    const ring = page.getByTestId("tool-palette");
    await expect(page.getByTestId("palette-slot-2")).toHaveAttribute("data-highlighted", "true");
    await expect(ring).toHaveScreenshot(`create-ring-${scheme}.png`);
  });
}

test("both hands' pointers: the left amber over a control, the right with the Wall tool", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  bridge = await startTestBridge(page);
  await openViewer(page);
  await settled(page);
  await page.keyboard.press("w");
  await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
  const control = page.getByRole("button", { name: "Open project" });
  const box = await control.boundingBox();
  const viewer = await page.getByTestId("viewer").boundingBox();
  if (!box || !viewer) throw new Error("not laid out");
  const overControl: [number, number] = [
    (box.x + box.width / 2 - viewer.x) / viewer.width,
    (box.y + box.height / 2 - viewer.y) / viewer.height,
  ];
  const right = await handAt(page, [0.55, 0.45]);
  const left = await handAt(page, overControl);
  await page.evaluate(([r, l]) => window.__AEX_INPUT__?.pointer(r, l), [right, left] as const);
  await expect(page.getByTestId("hand-pointer-left")).toHaveAttribute("data-mode", "press");
  await expect(page.getByTestId("hand-pointer-right")).toHaveAttribute("data-mode", "wall");
  await page.mouse.move(viewer.x + 4, viewer.y + viewer.height - 4); // out of the way
  await settled(page);
  await expect(page.getByTestId("viewer")).toHaveScreenshot("two-pointers.png");
});

test("lowered section", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  bridge = await startTestBridge(page);
  await openViewer(page);
  await settled(page);
  await page.keyboard.press("s");
  const box = await page.getByTestId("viewer").boundingBox();
  if (!box) throw new Error("viewer not laid out");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId("section-status")).toContainText("mm");
  await page.mouse.move(box.x + 4, box.y + box.height - 4); // out of the way
  await settled(page);
  await expect(page.getByTestId("viewer")).toHaveScreenshot("section-lowered.png");
});

test("reference markers: two elements captured while speaking show markers 1 and 2", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  bridge = await startTestBridge(page);
  await openViewer(page);
  await settled(page);
  // What point-and-speak records: the pointer rests on a column, then on a wall, each for 400 ms.
  await page.evaluate(() => {
    const context = window.__AEX_VOICE__?.context;
    context?.begin(0, null);
    context?.hover("col-b2", 0);
    context?.hover("wall-s", 400);
    context?.hover(null, 800);
    context?.end(1000);
  });
  await expect(page.getByTestId("reference-marker")).toHaveCount(2);
  await settled(page);
  await expect(page.getByTestId("viewer")).toHaveScreenshot("reference-markers.png");
});
