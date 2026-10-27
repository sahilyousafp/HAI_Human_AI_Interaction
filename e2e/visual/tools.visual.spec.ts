import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../../apps/bridge/src/server.ts";
import { handAt, openViewer, startTestBridge } from "../viewer.ts";

let bridge: Bridge | null = null;
// A microphone that hears silence, for every page here: a long pinch listens, and a microphone error midway would
// change what is shown. No camera starts, so nothing else in view changes.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.video) throw new DOMException("No camera here", "NotFoundError");
      const context = new AudioContext();
      const silence = context.createMediaStreamDestination();
      context.createConstantSource().connect(silence);
      return silence.stream;
    };
  });
});
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

/** Waits until the view has stopped drawing (the camera eased into place), so screenshots are stable. */
async function settled(page: Page) {
  const renders = () => page.evaluate(() => window.__HAI_VIEWER__?.renders() ?? 0);
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
  test(`the action ring (${scheme})`, async ({ page }) => {
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
    await expect(palette).toHaveScreenshot(`action-ring-${scheme}.png`);
    await page.keyboard.up(" ");
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`the left hand's reference ring (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    bridge = await startTestBridge(page);
    await openViewer(page);
    await settled(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    const centre = await handAt(page, [0.6, 0.5]);
    const send = (type: string, position: [number, number]) =>
      page.evaluate(
        (e) =>
          window.__HAI_INPUT__?.gestures([{ confidence: 1, delta: [0, 0], hand: "Left", ...e } as never]),
        { type, position, ts: Date.now() },
      );
    await send("pinch.drag.start", centre);
    await send("pinch.hold", centre);
    await send("pinch.drag.update", [centre[0] + 0.08, centre[1]]); // toward Place marker, on the right
    const ring = page.getByTestId("tool-palette");
    await expect(page.getByTestId("palette-slot-2")).toHaveAttribute("data-highlighted", "true");
    await expect(ring).toHaveScreenshot(`reference-ring-${scheme}.png`);
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
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
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
  await page.evaluate(([r, l]) => window.__HAI_INPUT__?.pointer(r, l), [right, left] as const);
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
    const context = window.__HAI_VOICE__?.context;
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

for (const scheme of ["light", "dark"] as const) {
  test(`sketches and lettered markers (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    bridge = await startTestBridge(page);
    await openViewer(page);
    await settled(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    // An outline by the left hand and a path by the right, on open ground in front of the model, and two markers.
    const ground = async (x: number, y: number) => {
      const v = await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.project([x, y, 0]), [x, y] as const);
      if (!v) throw new Error("not on screen");
      return page.evaluate(([vx, vy]) => window.__HAI_VIEWER__?.handAt(vx, vy), v);
    };
    const gesture = async (hand: "Left" | "Right", type: string, x: number, y: number) =>
      page.evaluate(
        (e) =>
          window.__HAI_INPUT__?.gestures([{ confidence: 1, delta: [0, 0], ts: performance.now(), ...e }]),
        { type, hand, position: await ground(x, y) },
      );
    await page.keyboard.press("e");
    // On the open ground in front of the model that the view shows beside the chat.
    const outline: Array<[number, number]> = [
      [4000, -2000],
      [10_000, -2000],
      [10_000, -6000],
      [4000, -6000],
      [4000, -3000],
    ];
    for (const [n, [x, y]] of outline.entries()) {
      const type =
        n === 0 ? "pinch.drag.start" : n === outline.length - 1 ? "pinch.drag.end" : "pinch.drag.update";
      if (type === "pinch.drag.end") await gesture("Left", "pinch.drag.update", x, y);
      await gesture("Left", type, x, y);
    }
    await page.keyboard.press("l");
    await gesture("Right", "pinch.drag.start", 13_000, -2000);
    await gesture("Right", "pinch.drag.update", 20_000, -2000);
    await gesture("Right", "pinch.drag.update", 17_000, -5000);
    await gesture("Right", "pinch.drag.end", 17_000, -5000);
    await page.keyboard.press("k");
    await gesture("Right", "pinch.tap", 7000, -4000);
    await gesture("Right", "pinch.tap", 16_000, -3500);
    await page.keyboard.press("v");
    await expect(page.getByTestId("letter-marker")).toHaveCount(2);
    await expect(page.getByTestId("sketch-label")).toHaveCount(2);
    await settled(page);
    await expect(page.getByTestId("viewer")).toHaveScreenshot(`sketches-and-markers-${scheme}.png`);
  });
}

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1280, 1920]) {
    test(`hold to talk: the progress ring, then the silent hold's ring with the chip under it (${scheme}, ${width})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 1080 });
      await page.emulateMedia({ colorScheme: scheme });
      bridge = await startTestBridge(page);
      await openViewer(page);
      await settled(page);
      await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
      const hand = await handAt(page, [0.62, 0.42]);
      const area = async () => {
        const box = await page.getByTestId("viewer").boundingBox();
        if (!box) throw new Error("viewer not laid out");
        const [x, y] = [box.x + box.width * 0.62, box.y + box.height * 0.42];
        return { x: x - 60, y: y - 60, width: 360, height: 120 };
      };
      // The left hand (the one that talks): fingers closing and the hand still: frames until the ring shows, so it is caught part-filled however slow
      // the machine is (how far it filled varies a little, so this shot allows a larger difference).
      const closing = () =>
        page.evaluate(
          (p) => window.__HAI_INPUT__?.pointer(null, p as [number, number], { Left: true }),
          hand,
        );
      const progress = page.getByTestId("hold-progress-left");
      for (let i = 0; i < 40 && !(await progress.isVisible()); i++) {
        await closing();
        await page.waitForTimeout(60);
      }
      await expect(page.getByTestId("hold-progress-left")).toBeVisible();
      await expect(page).toHaveScreenshot(`hold-progress-${scheme}-${width}.png`, {
        clip: await area(),
        maxDiffPixelRatio: 0.06,
      });
      // The long pinch fires: the microphone glyph in the pointer, and the chip beside it.
      const send = (type: string) =>
        page.evaluate(
          (e) =>
            window.__HAI_INPUT__?.gestures([{ confidence: 1, delta: [0, 0], hand: "Left", ...e } as never]),
          { type, position: hand, ts: performance.now() },
        );
      await page.evaluate((p) => window.__HAI_INPUT__?.pointer(null, p as [number, number]), hand);
      await send("pinch.drag.start");
      await send("pinch.hold");
      // The left hand talks. Silent: after 0.6 s its reference ring shows around the hand, and the chip moves under it.
      await expect(page.getByTestId("held-chip")).toHaveText("Listening. Speak now.", { timeout: 15_000 });
      await expect(page.getByTestId("tool-palette")).toBeVisible();
      await expect(page.getByTestId("held-chip")).toHaveAttribute("data-ring", "true");
      const ring = await area();
      await expect(page).toHaveScreenshot(`held-chip-${scheme}-${width}.png`, {
        clip: { x: ring.x - 90, y: ring.y - 90, width: 330, height: 330 },
      });
      await send("pinch.drag.end");
    });
  }
}
