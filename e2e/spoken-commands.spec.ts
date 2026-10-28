import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// Spoken commands: a transcript the grammar fully understands runs on what is selected as one undo step, without the
// agent; anything else is the agent's, or, with Claude chat off, "Not a command".
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

const say = (page: Page, text: string) => page.evaluate((t) => window.__HAI_VOICE__?.hear(t), text);
const select = (page: Page, ...ids: string[]) => page.evaluate((i) => window.__HAI_SCENE__?.select(i), ids);
const elements = () =>
  Object.values(bridge?.scene.scene.doc.elements ?? {}) as Array<Record<string, unknown>>;
const rotationOf = (id: string) =>
  (bridge?.scene.scene.doc.elements[id] as { rotationDeg?: number } | undefined)?.rotationDeg;
const massings = () => elements().filter((e) => e.type === "massing");

test("copy 2 times 6 m along y makes two copies in one undo step, selected", async ({ page }) => {
  await start(page);
  const before = massings().length;
  const original = bridge?.scene.scene.doc.elements["block-b"] as { origin: number[] };
  await select(page, "block-b");
  await say(page, "copy 2 times 6 m along y");
  await expect.poll(() => massings().length).toBe(before + 2);
  const ys = massings()
    .filter((e) => e.id !== "block-b" && String(e.name).includes("copy"))
    .map((e) => (e.origin as number[])[1] ?? 0)
    .sort((x, y) => x - y);
  const y0 = original.origin[1] ?? 0;
  expect(ys).toEqual([y0 + 6000, y0 + 12000]);
  await expect(page.getByTestId("voice-picked")).toContainText("Copy 2 times 6 m north");
  await expect(page.getByTestId("voice-picked")).toContainText("Nothing was sent to the agent");

  // One undo takes both copies away.
  await page.evaluate(() => window.__HAI_SCENE__?.undo());
  await expect.poll(() => massings().length).toBe(before);
});

test("copy and rotate 90 leaves the original and turns the copy", async ({ page }) => {
  await start(page);
  await select(page, "block-b");
  await say(page, "copy and rotate 90");
  await expect.poll(() => massings().find((e) => e.rotationDeg === 90)).toBeTruthy();
  expect(bridge?.scene.scene.doc.elements["block-b"]).not.toHaveProperty("rotationDeg");
});

test("rotate 90 turns what is selected about its centre", async ({ page }) => {
  await start(page);
  const before = bridge?.scene.scene.doc.elements["block-b"] as { origin: number[]; size: number[] };
  await select(page, "block-b");
  await say(page, "rotate 90");
  await expect.poll(() => rotationOf("block-b")).toBe(90);
  const after = bridge?.scene.scene.doc.elements["block-b"] as { origin: number[]; size: number[] };
  const centre = (e: { origin: number[]; size: number[] }) => [
    (e.origin[0] ?? 0) + (e.size[0] ?? 0) / 2,
    (e.origin[1] ?? 0) + (e.size[1] ?? 0) / 2,
  ];
  expect(centre(after)).toEqual(centre(before));
});

test("with nothing selected a command says so and changes nothing", async ({ page }) => {
  await start(page);
  const before = JSON.stringify(elements());
  await say(page, "rotate 90");
  await expect(page.getByTestId("voice-picked")).toContainText("Select something first.");
  expect(JSON.stringify(elements())).toBe(before);
});

test("delete this asks first, and Enter deletes", async ({ page }) => {
  await start(page);
  await select(page, "block-b");
  await say(page, "delete this");
  await expect(page.getByText(/Delete Block B tower\? Nod or press Enter/)).toBeVisible();
  expect(bridge?.scene.scene.doc.elements["block-b"]).toBeTruthy();
  await page.keyboard.press("Enter");
  await expect.poll(() => bridge?.scene.scene.doc.elements["block-b"]).toBeUndefined();
});

test("with Claude chat off, the chat is gone and what is not a command is not sent anywhere", async ({
  page,
}) => {
  await start(page);
  await expect(page.getByTestId("agent-panel")).toBeVisible();
  await openSettings(page, "features");
  await page.getByTestId("feature-agent").click();
  await expect(page.getByTestId("agent-panel")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await say(page, "make the building taller");
  await expect(page.getByTestId("voice-picked")).toContainText("Not a command: make the building taller");

  // A command still works.
  await select(page, "block-b");
  await say(page, "rotate 90");
  await expect.poll(() => rotationOf("block-b")).toBe(90);
});

test("rotate 90 about marker A turns the block about the marker, not about itself", async ({ page }) => {
  await start(page);
  const block = bridge?.scene.scene.doc.elements["block-b"] as { origin: number[]; size: number[] };
  const centre = [
    (block.origin[0] ?? 0) + (block.size[0] ?? 0) / 2,
    (block.origin[1] ?? 0) + (block.size[1] ?? 0) / 2,
  ];
  const marker = [(centre[0] ?? 0) + 10000, centre[1] ?? 0, 0];
  await page.evaluate(
    (point) => window.__HAI_TOOLS__?.references.loadMarkers([{ letter: "A", point }]),
    marker,
  );
  await select(page, "block-b");
  await say(page, "rotate 90 about marker A");
  await expect.poll(() => rotationOf("block-b")).toBe(90);
  const turned = bridge?.scene.scene.doc.elements["block-b"] as { origin: number[]; size: number[] };
  // The centre was 10 m west of the marker; a quarter turn counter-clockwise puts it 10 m south of it.
  expect((turned.origin[0] ?? 0) + (turned.size[0] ?? 0) / 2).toBeCloseTo(marker[0] ?? 0, 0);
  expect((turned.origin[1] ?? 0) + (turned.size[1] ?? 0) / 2).toBeCloseTo((marker[1] ?? 0) - 10000, 0);
  await expect(page.getByTestId("voice-picked")).toContainText("Rotate 90° about marker A");
});

test("a marker that has not been placed is said so, and nothing moves", async ({ page }) => {
  await start(page);
  const before = JSON.stringify(bridge?.scene.scene.doc.elements["block-b"]);
  await select(page, "block-b");
  await say(page, "move to marker Q");
  await expect(page.getByTestId("tool-notice")).toContainText("There is no marker Q");
  expect(JSON.stringify(bridge?.scene.scene.doc.elements["block-b"])).toBe(before);
});
