import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { type ContextItem, Site } from "../packages/protocol/src/index.ts";
import { allow } from "./budget.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { findElementOnScreen, openViewer, startTestBridge } from "./viewer.ts";

// The city context: fetched buildings, trees and ground data are drawn read-only beside the model, never picked, hidden
// for the user by Show context, marked out of date when the site changes, and adopted by writers only.

const site = Site.parse({ lat: 52.37, lon: 4.9 });
// A one-pixel PNG: enough for the overlay to have a picture to draw.
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const building = (id: string, x: number, y: number, w: number, d: number, h: number): ContextItem => ({
  id,
  kind: "building",
  footprint: [
    [x, y],
    [x + w, y],
    [x + w, y + d],
    [x, y + d],
  ],
  heightMm: h,
  heightSource: "measured",
  baseMm: 0,
  source: "overpass",
});

const raster: ContextItem = {
  id: "ground-temperature",
  kind: "raster",
  label: "Ground temperature",
  quantity: "Surface temperature",
  unit: "degrees C",
  source: "planetary-computer",
  date: "2026-09-28T10:30:00Z",
  minMm: [-20_000, -20_000],
  maxMm: [70_000, 60_000],
  image: PIXEL,
  range: [18, 41],
  legend: [
    { value: 18, color: "#2b6cb0" },
    { value: 30, color: "#f6e05e" },
    { value: 41, color: "#c53030" },
  ],
};

let bridge: Awaited<ReturnType<typeof startTestBridge>> | null = null;
test.afterEach(async () => {
  await (bridge?.agent as Team | null)?.stopAll();
  await bridge?.stop();
  bridge = null;
});

async function start(page: Page, withAgent = false) {
  bridge = await startTestBridge(page, {
    ...(withAgent ? { agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-context-"))) } : {}),
  });
  bridge.site.set(site);
  await openViewer(page);
  if (withAgent) {
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
  }
  return bridge;
}

const held = (page: Page) => page.evaluate(() => window.__HAI_VIEWER__?.context?.());

test("neighbours, trees and a ground overlay are drawn, with a legend and credits, in both themes", async ({
  page,
}, testInfo) => {
  const b = await start(page);
  b.context.replace(
    "overpass",
    "building",
    [
      building("way/1", 45_000, 5_000, 14_000, 20_000, 24_000),
      building("way/2", -25_000, 10_000, 18_000, 12_000, 15_000),
    ],
    site,
    "2026-10-01",
  );
  b.context.replace(
    "overpass",
    "tree",
    [{ id: "node/1", kind: "tree", position: [42_000, -6_000], source: "overpass" }],
    site,
  );
  b.context.replace("planetary-computer", "raster", [raster], site, "2026-09-28T10:30:00Z");
  await expect
    .poll(() => held(page))
    .toMatchObject({ buildings: 2, trees: 1, rasters: 1, visible: true, stale: false });
  const legend = page.getByTestId("context-legend");
  await expect(legend).toContainText("Ground temperature");
  await expect(legend).toContainText("degrees C");
  await expect(legend).toContainText("Landsat (Planetary Computer), 2026-09-28");
  await expect(page.getByTestId("context-credits")).toContainText("OpenStreetMap contributors");
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath("context-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath("context-dark.png") });
});

test("the layer is never picked: a building standing over a column leaves the column what a pinch selects", async ({
  page,
}) => {
  const b = await start(page);
  // Whichever of the sample's columns is clear on screen (the chat takes the view's left).
  const columns = Object.values(b.scene.scene.doc.elements).filter((e) => e.type === "column");
  let found: { id: string; at: [number, number] } | null = null;
  for (const c of columns) {
    if (found) break;
    found = await findElementOnScreen(page, c.id).then(
      (at) => ({ id: c.id, at }),
      () => null,
    );
  }
  if (!found) throw new Error("no column is clear on screen");
  const { id, at } = found;
  const before = await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x as number, y as number), at);
  expect(before).toBe(id);
  // A tall context building around the column, between it and the camera.
  const column = b.scene.scene.doc.elements[id];
  if (column?.type !== "column") throw new Error(`no ${id}`);
  const [cx, cy] = column.position;
  b.context.replace(
    "overpass",
    "building",
    [building("way/9", cx - 3_000, cy - 3_000, 6_000, 6_000, 60_000)],
    site,
  );
  await expect.poll(() => held(page)).toMatchObject({ buildings: 1 });
  await page.waitForTimeout(300);
  const after = await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x as number, y as number), at);
  expect(after).toBe(id);
});

test("Show context hides it for the user, brings it back, and a changed site marks it out of date", async ({
  page,
}) => {
  const b = await start(page);
  b.context.replace("overpass", "building", [building("way/1", 45_000, 5_000, 14_000, 20_000, 24_000)], site);
  await expect.poll(() => held(page)).toMatchObject({ visible: true, buildings: 1 });
  await openSettings(page, "open-data");
  await page.getByTestId("show-context").click();
  await expect(page.getByTestId("show-context")).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => held(page)).toMatchObject({ visible: false, buildings: 1 });
  await expect(page.getByTestId("context-legend")).toHaveCount(0);
  await page.getByTestId("show-context").click();
  await expect.poll(() => held(page)).toMatchObject({ visible: true });
  await closeSettings(page);
  await expect(page.getByTestId("context-legend")).toBeVisible();
  await expect(page.getByTestId("context-stale")).toHaveCount(0);
  b.site.set(Site.parse({ lat: 40, lon: -3 }));
  await expect(page.getByTestId("context-stale")).toBeVisible();
  await expect.poll(() => held(page)).toMatchObject({ stale: true });
});

test("a writer adopts a neighbour into the model, a reader cannot, and a claim keeps it inside its region", async ({
  page,
}) => {
  const b = await start(page, true);
  const team = b.agent as Team;
  b.context.replace(
    "overpass",
    "building",
    [
      building("way/1", 45_000, 5_000, 14_000, 20_000, 24_000),
      building("way/2", 200_000, 0, 10_000, 10_000, 9_000),
    ],
    site,
  );
  await team.request(`delegate architect: tool context_adopt {"ids":["way/1"]}`);
  await team.settled();
  expect(b.scene.scene.doc.elements["ctx-way-1"]).toMatchObject({
    type: "slab",
    thickness: 24_000,
    tags: { "context.id": "way/1", "hai.owner": "architect" },
  });
  // A reader is not offered the tool: the call never reaches the model.
  await team.request(`delegate urban: tool context_adopt {"ids":["way/2"]}`);
  await team.settled();
  expect(b.scene.scene.doc.elements["ctx-way-2"]).toBeUndefined();
  // Inside a claim for a region that does not hold the building: refused, nothing added.
  await team.request(`delegate architect(0,0,1000,1000): tool context_adopt {"ids":["way/2"]}`);
  await team.settled();
  expect(b.scene.scene.doc.elements["ctx-way-2"]).toBeUndefined();
  expect(team.board.at(-1)?.summary ?? "").toMatch(/claim|outside|Refused/i);
});

test("2000 buildings on screen: they arrive in a moment and the user's own frames keep coming while the view is turned", async ({
  page,
}) => {
  const b = await start(page);
  const software = (await page.locator("canvas").first().getAttribute("data-renderer")) === "software";
  const many = Array.from({ length: 2000 }, (_, i) =>
    building(
      `way/${i}`,
      -300_000 + (i % 50) * 14_000,
      -300_000 + Math.floor(i / 50) * 14_000,
      9_000,
      9_000,
      6_000 + (i % 7) * 3_000,
    ),
  );
  const started = Date.now();
  b.context.replace("overpass", "building", many, site);
  await expect.poll(() => held(page)).toMatchObject({ buildings: 2000 });
  const arrived = Date.now() - started;
  // The user's own frames while the view is turned with the mouse: how long the longest gap between two is.
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[] };
    w.__gaps = [];
    let last = performance.now();
    const tick = (now: number) => {
      w.__gaps.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await page.mouse.down({ button: "middle" });
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(box.x + box.width * (0.6 + i * 0.004), box.y + box.height * 0.6);
    await page.waitForTimeout(25);
  }
  await page.mouse.up({ button: "middle" });
  const gaps = (await page.evaluate(() => (window as unknown as { __gaps: number[] }).__gaps)).slice(2);
  const sorted = [...gaps].sort((x, y) => x - y);
  const p90 = sorted[Math.ceil(sorted.length * 0.9) - 1] as number;
  const longest = Math.max(...gaps);
  console.log(
    `context layer (${software ? "software" : "gpu"}): 2000 buildings arrived in ${arrived} ms; frame gap p90 ${Math.round(p90)} ms, longest ${Math.round(longest)} ms over ${gaps.length} frames`,
  );
  expect(arrived).toBeLessThan(software ? 8000 : 3000);
  expect(longest).toBeLessThan(software ? 800 : allow(120, 800));
});

test("a neighbour south of the model casts its shadow on it in a sun-study picture, even with Show context off", async ({
  page,
}, testInfo) => {
  const b = await start(page);
  // A software renderer draws no shadows (they cost seconds a frame there), so there is nothing to compare.
  const software = (await page.locator("canvas").first().getAttribute("data-renderer")) === "software";
  test.skip(software, "this machine draws in software, which leaves shadows out");
  const picture = async () => {
    const token = b.agentTokens.issue({ agent: "climate", tools: new Set(["sun_study"]) });
    const res = await fetch(`http://127.0.0.1:${b.port}/mcp`, {
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
        params: {
          name: "sun_study",
          arguments: { date: "2026-12-21", time: "12:00", latitude: 51.5, longitude: 0, utcOffsetHours: 0 },
        },
      }),
    });
    const body = await res.text();
    const data = body
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .at(-1)
      ?.slice(5);
    const result = JSON.parse(data ?? body).result as {
      content: Array<{ type: string; data?: string; text?: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBeFalsy();
    const image = result.content.find((c) => c.type === "image");
    if (!image?.data) throw new Error(`no picture: ${JSON.stringify(result.content).slice(0, 300)}`);
    return image.data;
  };
  const without = await picture();
  // Show context is off for the user: the picture must still have the neighbour and its shadow.
  b.context.replace("overpass", "building", [building("way/s", 0, -40_000, 50_000, 12_000, 30_000)], site);
  await expect.poll(() => held(page)).toMatchObject({ buildings: 1 });
  await openSettings(page, "open-data");
  await page.getByTestId("show-context").click();
  await expect.poll(() => held(page)).toMatchObject({ visible: false });
  await closeSettings(page);
  const withIt = await picture();
  writeFileSync(testInfo.outputPath("without.png"), Buffer.from(without, "base64"));
  writeFileSync(testInfo.outputPath("with.png"), Buffer.from(withIt, "base64"));
  const share = await page.evaluate(
    async ([a, c]) => {
      const load = (b64: string) =>
        new Promise<ImageData>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
            ctx.drawImage(img, 0, 0);
            resolve(ctx.getImageData(0, 0, img.width, img.height));
          };
          img.src = `data:image/png;base64,${b64}`;
        });
      const [x, y] = await Promise.all([load(a as string), load(c as string)]);
      let different = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const d =
          Math.abs((x.data[i] as number) - (y.data[i] as number)) +
          Math.abs((x.data[i + 1] as number) - (y.data[i + 1] as number)) +
          Math.abs((x.data[i + 2] as number) - (y.data[i + 2] as number));
        if (d > 40) different++;
      }
      return different / (x.data.length / 4);
    },
    [without, withIt],
  );
  console.log(
    `sun study: ${(share * 100).toFixed(1)} % of the picture changed with a neighbour in the layer`,
  );
  expect(share).toBeGreaterThan(0.02);
});
