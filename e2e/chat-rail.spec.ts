import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { handAt, now, openViewer, startTestBridge } from "./viewer.ts";

// The chat docked down the left of the workspace: beside the model, resizable by mouse, keys and hand, folded to a
// strip, and its turns with several tool calls folded to one steps line.
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

async function start(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  bridge = await startTestBridge(page, { agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-rail-"))) });
  await openViewer(page);
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
}

const rail = (page: Page) => page.getByTestId("agent-panel");
const handle = (page: Page) => page.getByTestId("agent-rail-resize");
const lastTurn = (page: Page) => page.getByTestId("agent-turn").last();

async function ask(page: Page, text: string) {
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
  await page.getByTestId("agent-input").fill(text);
  await page.getByTestId("agent-input").press("Enter");
}

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`${testId} is not laid out`);
  return b;
}

test("the rail docks beside the model: full height, 380 px, and the model starts at its edge", async ({
  page,
}) => {
  await start(page);
  const r = await box(page, "agent-panel");
  const v = await box(page, "viewer");
  expect(r.x).toBe(0);
  expect(Math.round(r.width)).toBe(380);
  expect(Math.round(v.x)).toBe(380);
  // Full height of the workspace, under the header.
  expect(Math.round(r.y + r.height)).toBe(900);
});

test("Resize by dragging: the edge dragged 100 px right makes a 480 px rail, kept after a reload", async ({
  page,
}) => {
  await start(page);
  const h = await box(page, "agent-rail-resize");
  const [x, y] = [h.x + h.width / 2, h.y + h.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 50, y, { steps: 5 });
  await page.mouse.move(x + 100, y, { steps: 5 });
  await page.mouse.up();
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "480");
  await page.reload();
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "480");
  expect(Math.round((await box(page, "viewer")).x)).toBe(480);
  // It stops at 560, and a double-click puts it back to 380.
  const h2 = await box(page, "agent-rail-resize");
  await page.mouse.move(h2.x + h2.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(h2.x + 400, y, { steps: 8 });
  await page.mouse.up();
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "560");
  await handle(page).dblclick();
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "380");
});

test("A hand press steps the width, and the arrow keys move it 16 px", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  const h = await box(page, "agent-rail-resize");
  const v = await box(page, "viewer");
  const at = await handAt(page, [(h.x + h.width / 2 - v.x) / v.width, (h.y + h.height / 2 - v.y) / v.height]);
  await page.evaluate((p) => window.__HAI_INPUT__?.pointer(null, p), at);
  await expect(handle(page)).toHaveAttribute("data-hand-hover", "left");
  const ts = await now(page);
  await page.evaluate(
    (e) => window.__HAI_INPUT__?.gestures([{ confidence: 1, delta: [0, 0], ...e } as never]),
    { type: "pinch.tap", hand: "Left", position: at, ts },
  );
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "460");
  await handle(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "444");
  await page.keyboard.press("Home");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "320");
});

test("Collapsed, the rail is a 52 px strip with the status and the microphone, and the model widens", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Hide the agent panel" }).click();
  await expect(rail(page)).toHaveAttribute("data-collapsed", "true");
  expect(Math.round((await box(page, "agent-panel")).width)).toBe(52);
  expect(Math.round((await box(page, "viewer")).x)).toBe(52);
  await expect(rail(page).getByTestId("agent-status")).toBeVisible();
  await expect(rail(page).getByTestId("mic-button")).toBeVisible();
  await expect(handle(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Show the agent panel" }).click();
  expect(Math.round((await box(page, "agent-panel")).width)).toBe(380);
});

/** Hands a request to Architect and opens its thread, where its own tool calls are. */
async function architectDoes(page: Page, request: string) {
  await ask(page, `delegate architect: ${request}`);
  await lastTurn(page).getByTestId("handoff-chip").click();
  return page.getByTestId("task-transcript").getByTestId("agent-turn").last();
}

test("Several finished calls fold to one line: three columns read 3 steps, done, and open to three chips", async ({
  page,
}) => {
  await start(page);
  const turn = await architectDoes(page, "columns 3");
  await expect(turn).toHaveAttribute("data-ended", "done");
  const steps = turn.getByTestId("agent-steps");
  await expect(steps).toHaveAttribute("data-outcome", "done");
  await expect(steps.locator(".agent-steps-head")).toContainText("3 steps, done");
  await expect(steps).not.toHaveAttribute("open", "");
  await expect(steps.getByTestId("tool-chip").first()).toBeHidden();
  await steps.locator(".agent-steps-head").click();
  await expect(steps.getByTestId("tool-chip")).toHaveCount(3);
  await expect(steps.getByTestId("tool-chip").first()).toBeVisible();
});

test("a running group stays open while its turn runs, and folds when it is done", async ({ page }) => {
  await start(page);
  const turn = await architectDoes(page, "columns 3 every 1500");
  const steps = turn.getByTestId("agent-steps");
  await expect(steps.locator(".agent-steps-head")).toContainText(/steps (so far|, 1 running)/);
  await expect(steps).toHaveAttribute("open", "");
  await expect(turn).toHaveAttribute("data-ended", "done", { timeout: 15_000 });
  await expect(steps.locator(".agent-steps-head")).toContainText("3 steps, done");
  await expect(steps).not.toHaveAttribute("open", "");
});

test("failed calls keep their line open and say so; a single call is a plain chip", async ({ page }) => {
  await start(page);
  // Mochi itself cannot create elements, so each of its three calls fails.
  await ask(page, "columns 3");
  await expect(lastTurn(page)).toHaveAttribute("data-ended", "done");
  const steps = lastTurn(page).getByTestId("agent-steps");
  await expect(steps).toHaveAttribute("data-outcome", "failed");
  await expect(steps.locator(".agent-steps-head")).toContainText("3 steps, 3 failed");
  await expect(steps).toHaveAttribute("open", "");
  await ask(page, "shell: echo hi");
  await expect(lastTurn(page).getByTestId("agent-steps")).toHaveCount(0);
  await expect(lastTurn(page).getByTestId("tool-chip")).toHaveAttribute("data-outcome", "waiting");
});

test("narrow screens: the chat is a sheet over the bottom of the model, at most half its height", async ({
  page,
}) => {
  await start(page);
  await page.setViewportSize({ width: 800, height: 900 });
  const r = await box(page, "agent-panel");
  const v = await box(page, "viewer");
  expect(Math.round(v.x)).toBe(0);
  expect(Math.round(r.width)).toBe(800);
  expect(r.height).toBeLessThanOrEqual(v.height / 2 + 1);
  expect(Math.round(r.y + r.height)).toBe(Math.round(v.y + v.height));
  await expect(handle(page)).toBeHidden();
});
