import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { camera, openViewer, startTestBridge } from "./viewer.ts";

// The view cube at the viewport's right: true orthographic views, and the way back.
let bridge: (Bridge & { port: number }) | null = null;
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

/** The agent's set_view: a JSON-RPC call to the bridge's MCP server with a token issued to it. */
async function agentSetView(args: Record<string, unknown>): Promise<{ isError?: boolean }> {
  if (!bridge) throw new Error("no bridge");
  const token = bridge.agentTokens.issue({ agent: "reviewer", tools: new Set(["set_view"]) });
  const res = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "set_view", arguments: args },
    }),
  });
  const body = await res.text();
  const data = body
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .at(-1);
  return JSON.parse(data ? data.slice(5) : body).result;
}

test("the agent can ask for Front, and for perspective again", async ({ page }) => {
  await start(page);
  expect((await agentSetView({ view: "front" })).isError).toBeFalsy();
  await expect(viewer(page)).toHaveAttribute("data-view", "front");
  await expect(page.getByTestId("view-front")).toHaveAttribute("aria-pressed", "true");
  expect((await agentSetView({ view: "perspective" })).isError).toBeFalsy();
  await expect(viewer(page)).toHaveAttribute("data-view", "perspective");
});

test("the agent cannot name a view and a direction together", async ({ page }) => {
  await start(page);
  expect((await agentSetView({ view: "top", azimuth: 90 })).isError).toBe(true);
  await expect(viewer(page)).toHaveAttribute("data-view", "perspective");
});
