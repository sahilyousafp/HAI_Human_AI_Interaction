import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { openSettings } from "./settings.ts";
import { findElementOnScreen, openViewer, startTestBridge } from "./viewer.ts";

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

test("what the speech model mishears is put right by sound, against the app's own words", async ({
  page,
}) => {
  await start(page);
  await select(page, "block-b");
  await say(page, "colon"); // Column, as the model hears it
  await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "column");
  const width = () =>
    (bridge?.scene.scene.doc.elements["block-b"] as { size: number[] } | undefined)?.size[0];
  const before = width() ?? 0;
  await say(page, "scale to");
  await expect.poll(width).toBe(before * 2);
  await expect(page.getByTestId("voice-picked")).toContainText("Nothing was sent to the agent");
});

test("it does not have to be said precisely: talk around a command is dropped, and left and right are directions", async ({
  page,
}) => {
  await start(page);
  await select(page, "block-b");
  const originX = () =>
    (bridge?.scene.scene.doc.elements["block-b"] as { origin: number[] } | undefined)?.origin[0] ?? 0;
  const before = originX();
  await say(page, "I want to move this two metres to the right, thanks");
  await expect.poll(originX).toBe(before + 2000);
  await say(page, "could you please push it a metre to the left");
  await expect.poll(originX).toBe(before + 1000);
  await expect(page.getByTestId("voice-picked")).toContainText("Nothing was sent to the agent");
});

test("move 5 meters to the y axis towards right, and array 5 times, run as commands with no agent", async ({
  page,
}) => {
  await start(page);
  await select(page, "block-b");
  const origin = () =>
    (bridge?.scene.scene.doc.elements["block-b"] as { origin: number[] } | undefined)?.origin ?? [0, 0, 0];
  const [x, y] = origin();
  await say(page, "move 5 meters to the y axis towards right");
  await expect.poll(() => origin()[1]).toBe((y ?? 0) + 5000);
  expect(origin()[0]).toBe(x);
  const before = massings().length;
  await say(page, "array 5 times");
  await expect.poll(() => massings().length).toBe(before + 5);
  const xs = massings()
    .filter((e) => String(e.name).includes("copy"))
    .map((e) => (e.origin as number[])[0] ?? 0)
    .sort((a, b) => a - b);
  const width = 12_000; // Block B is 12 m wide: the copies stand side by side
  expect(xs).toEqual([1, 2, 3, 4, 5].map((i) => (x ?? 0) + i * width));
  await expect(page.getByTestId("voice-picked")).toContainText("Nothing was sent to the agent");
});

test("say 5 m, then make it 4 m: the move is taken back and made again, one undo puts it all back", async ({
  page,
}) => {
  await start(page);
  await select(page, "block-b");
  const origin = () =>
    (bridge?.scene.scene.doc.elements["block-b"] as { origin: number[] } | undefined)?.origin ?? [0, 0, 0];
  const x = origin()[0] ?? 0;
  await say(page, "move 5 meters east");
  await expect.poll(() => origin()[0]).toBe(x + 5000);
  await say(page, "make it 4 m");
  await expect.poll(() => origin()[0]).toBe(x + 4000);
  await say(page, "no, change it to 3 metres");
  await expect.poll(() => origin()[0]).toBe(x + 3000);
  await expect(page.getByTestId("voice-picked")).toContainText("Nothing was sent to the agent");
  // Undo goes back to before the command, not to a half-way step.
  await page.evaluate(() => window.__HAI_SCENE__?.undo());
  await expect.poll(() => origin()[0]).toBe(x);
});

test("array 5 times, then make it 3: three copies, and what was done by hand since is not corrected", async ({
  page,
}) => {
  await start(page);
  await select(page, "block-b");
  const before = massings().length;
  await say(page, "array 5 times");
  await expect.poll(() => massings().length).toBe(before + 5);
  await say(page, "change it to 3 times");
  await expect.poll(() => massings().length).toBe(before + 3);
  // Something else changes the model: the next "make it" is no longer a correction of that array.
  await page.evaluate(() => window.__HAI_SCENE__?.apply("by hand", [{ op: "delete", id: "block-c" }]));
  await expect.poll(() => massings().length).toBe(before + 2);
  await say(page, "make it 6 times");
  await page.waitForTimeout(600);
  expect(massings().length).toBe(before + 2);
});

test("but what would change the meaning is not guessed: it is not a command", async ({ page }) => {
  await start(page);
  await select(page, "block-b");
  const before = JSON.stringify(bridge?.scene.scene.doc.elements);
  await say(page, "don't move this two metres to the right");
  await page.waitForTimeout(500);
  expect(JSON.stringify(bridge?.scene.scene.doc.elements)).toBe(before);
});

test("a word that sounds like nothing the app knows is left alone, and still goes to the agent", async ({
  page,
}) => {
  await start(page);
  await select(page, "block-b");
  const before = JSON.stringify(bridge?.scene.scene.doc.elements);
  await say(page, "copy for the wall");
  await page.waitForTimeout(500);
  expect(JSON.stringify(bridge?.scene.scene.doc.elements)).toBe(before);
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

test("with Claude chat off, a command can be typed, with or without the microphone", async ({ page }) => {
  await start(page);
  await openSettings(page, "features");
  await page.getByTestId("feature-agent").click();
  await expect(page.getByTestId("agent-panel")).toHaveCount(0);
  await page.keyboard.press("Escape");

  const input = page.getByTestId("command-input");
  await select(page, "block-b");
  await input.fill("rotate 90");
  await input.press("Enter");
  await expect.poll(() => rotationOf("block-b")).toBe(90);
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("voice-picked")).toContainText("Rotate 90");

  await input.fill("make the building taller");
  await input.press("Enter");
  await expect(page.getByTestId("voice-picked")).toContainText("Not a command: make the building taller");

  // Without the voice feature there is no microphone, and the box is still there.
  await openSettings(page, "features");
  await page.getByTestId("feature-voice").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-bar").getByTestId("mic-button")).toHaveCount(0);
  await input.fill("rotate 90");
  await input.press("Enter");
  await expect.poll(() => rotationOf("block-b")).toBe(180);
});

test("hide takes an element out of the user's view and picking, and it comes back with show all", async ({
  page,
}) => {
  await start(page);
  const at = await findElementOnScreen(page, "block-b");
  expect(await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x, y), at)).toBe("block-b");
  await select(page, "block-b");
  await say(page, "hide");
  await expect.poll(() => page.evaluate(() => window.__HAI_VIEWER__?.hiddenKept())).toEqual(["block-b"]);
  // The scene still holds it, so the agents' own pictures show it; the user can neither see nor pick it.
  expect(await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x, y), at)).not.toBe("block-b");
  await say(page, "show all");
  await expect.poll(() => page.evaluate(() => window.__HAI_VIEWER__?.hiddenKept())).toEqual([]);
  expect(await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x, y), at)).toBe("block-b");
});
