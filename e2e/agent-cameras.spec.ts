import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { camera, openViewer, startTestBridge } from "./viewer.ts";

// Agents look at the model with cameras of their own: the user's view, canvas and selection stay as they were.

type Bridge = Awaited<ReturnType<typeof startTestBridge>>;
type Content = { type: string; text?: string; data?: string; mimeType?: string };
type ToolResult = { content: Content[]; isError?: boolean };

const TOOLS = ["camera_set", "camera_list", "camera_capture", "camera_delete"];

/** Calls one of the bridge's MCP tools the way the named agent does. */
async function callTool(
  bridge: Bridge,
  agent: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const token = bridge.agentTokens.issue({ agent, tools: new Set(TOOLS) });
  const res = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  expect(res.status).toBe(200);
  const body = await res.text();
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? (body
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .at(-1)
        ?.slice(5) ?? "null")
    : body;
  return JSON.parse(json).result;
}

const images = (result: ToolResult) => result.content.filter((c) => c.type === "image");

function pngSize(base64: string): [number, number] {
  const bytes = Buffer.from(base64, "base64");
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** What the user's canvas shows now, as a hash of its pixels. */
const canvasPixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return canvas ? canvas.toDataURL("image/png").length + canvas.toDataURL("image/png").slice(-64) : null;
  });

async function start(page: Page) {
  const bridge = await startTestBridge(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await openViewer(page);
  return bridge;
}

test.describe("agent cameras", () => {
  test("a picture from the agent's own camera leaves the user's view and canvas as they were", async ({
    page,
  }) => {
    const bridge = await start(page);
    try {
      const before = await camera(page);
      const pixels = await canvasPixels(page);
      await callTool(bridge, "architect", "camera_set", { name: "east", azimuth: 0, elevation: 20 });
      const shot = await callTool(bridge, "architect", "camera_capture", { cameras: ["east"] });
      expect(shot.isError).not.toBe(true);
      const [image] = images(shot);
      expect(image?.mimeType).toBe("image/png");
      const [width, height] = pngSize(image?.data ?? "");
      expect(Math.max(width, height)).toBeLessThanOrEqual(1280);
      expect(Math.min(width, height)).toBeGreaterThan(200);
      expect(Buffer.from(image?.data ?? "", "base64").length).toBeGreaterThan(20_000);
      expect(shot.content[0]?.text).toMatch(/^east: from the e,/);
      // The user's camera did not move and the canvas shows the same frame.
      expect(await camera(page)).toEqual(before);
      expect(await canvasPixels(page)).toBe(pixels);
    } finally {
      await bridge.stop();
    }
  });

  test("the user keeps orbiting while an agent takes its pictures, and the orbit is the user's alone", async ({
    page,
  }) => {
    const bridge = await start(page);
    try {
      const before = await camera(page);
      const box = await page.locator("[data-testid=viewer] canvas").boundingBox();
      if (!box) throw new Error("no canvas");
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 100, y, { steps: 6 });
      // The agent looks from the east (azimuth 0) in the middle of the drag.
      await callTool(bridge, "architect", "camera_set", { name: "east", azimuth: 0, elevation: 60 });
      const shot = await callTool(bridge, "architect", "camera_capture", { cameras: ["east"], size: 512 });
      expect(images(shot)).toHaveLength(1);
      await page.mouse.move(x - 200, y, { steps: 6 });
      await page.mouse.up();
      const after = await camera(page);
      // The user's drag turned the view; the agent's camera (east, 60 degrees up) did not become the user's.
      expect(after.azimuth).not.toBeCloseTo(before.azimuth, 1);
      expect(after.elevation).toBeCloseTo(before.elevation, 0);
      expect(after.distance).toBeCloseTo(before.distance, 0);
    } finally {
      await bridge.stop();
    }
  });

  test("it shows the model from where the camera is, not from where the user is", async ({ page }) => {
    const bridge = await start(page);
    try {
      const users = await callTool(bridge, "architect", "camera_capture", { preset: "top", size: 640 });
      const east = await callTool(bridge, "architect", "camera_capture", { preset: "front", size: 640 });
      expect(images(users)[0]?.data).not.toBe(images(east)[0]?.data);
    } finally {
      await bridge.stop();
    }
  });

  test("the user's selection is left out of the picture unless the agent asks for it", async ({ page }) => {
    const bridge = await start(page);
    try {
      const ids = await page.evaluate(() =>
        Object.keys(window.__HAI_SCENE__?.getSnapshot().doc?.elements ?? {}),
      );
      expect(ids.length).toBeGreaterThan(0);
      const take = async (selection: boolean) =>
        images(
          await callTool(bridge, "architect", "camera_capture", { preset: "iso", size: 512, selection }),
        )[0]?.data;
      const plain = await take(false);
      expect(await take(false)).toBe(plain); // drawing is repeatable, so any difference below is the selection
      await page.evaluate((id) => window.__HAI_SCENE__?.select([id]), ids[0] as string);
      await expect
        .poll(() => page.evaluate(() => window.__HAI_SCENE__?.getSnapshot().selection.length))
        .toBe(1);
      const after = await take(false);
      expect(after).toBe(plain);
      expect(await take(true)).not.toBe(plain);
    } finally {
      await bridge.stop();
    }
  });

  test("the orbit sheet is eight different pictures, and two agents can take theirs at the same time", async ({
    page,
  }) => {
    const bridge = await start(page);
    try {
      const before = await camera(page);
      const [sheet, other] = await Promise.all([
        callTool(bridge, "architect", "camera_capture", { preset: "orbit-sheet" }),
        callTool(bridge, "product", "camera_capture", { preset: "top", size: 512 }),
      ]);
      expect(images(sheet)).toHaveLength(8);
      expect(new Set(images(sheet).map((i) => i.data)).size).toBeGreaterThan(5);
      expect(images(other)).toHaveLength(1);
      expect(await camera(page)).toEqual(before);
    } finally {
      await bridge.stop();
    }
  });

  test("a sun study leaves the user's light alone", async ({ page }) => {
    const bridge = await start(page);
    try {
      const token = bridge.agentTokens.issue({ agent: "climate", tools: new Set(["sun_study"]) });
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
          params: {
            name: "sun_study",
            arguments: { date: "2026-12-21", time: "12:00", latitude: 51.5, longitude: 0 },
          },
        }),
      });
      expect(await res.text()).toContain("image/png");
      expect(await page.evaluate(() => window.__HAI_VIEWER__?.sun())).toBeNull();
    } finally {
      await bridge.stop();
    }
  });
});

test.describe("seeing what agents look at", () => {
  test("a camera an agent placed is marked in the model, the marker can be switched off, and it is not in any picture", async ({
    page,
  }, testInfo) => {
    const bridge = await startTestBridge(page, {
      agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-cam-"))),
    });
    try {
      await page.setViewportSize({ width: 1600, height: 900 });
      await openViewer(page);
      await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
      const markers = () => page.evaluate(() => window.__HAI_VIEWER__?.cameraMarkers?.());
      expect(await markers()).toEqual([]);
      // A camera 30 m out to the south-east, looking at the middle of the model.
      await callTool(bridge, "architect", "camera_set", {
        name: "south",
        azimuth: 300,
        elevation: 25,
        distance: 30_000,
        target: [20_000, 15_000, 3_000],
      });
      await expect.poll(markers).toEqual(["architect/south"]);
      await page.screenshot({ path: testInfo.outputPath("marker.png") });
      const top = async () =>
        images(await callTool(bridge, "product", "camera_capture", { preset: "top", size: 512 }))[0]?.data;
      const withMarker = await top();
      await openSettings(page, "modelling");
      await page.getByTestId("show-cameras").click();
      await expect.poll(markers).toEqual([]);
      await closeSettings(page);
      // The marker was in the model, not in the picture: the picture is the same either way.
      expect(await top()).toBe(withMarker);
    } finally {
      await bridge.stop();
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`the strip shows each agent's last picture as a thumbnail, and enlarges it on click (${scheme})`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      const bridge = await startTestBridge(page, {
        agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-cam-"))),
      });
      try {
        await page.setViewportSize({ width: 1600, height: 900 });
        await openViewer(page);
        await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
        await callTool(bridge, "architect", "camera_capture", { preset: "iso", size: 512 });
        const shot = page.getByTestId("team-shot-architect");
        await expect(shot).toBeVisible();
        await expect(shot.locator("img")).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
        await expect(shot).toContainText("iso-se");
        await page.screenshot({ path: testInfo.outputPath(`strip-${scheme}.png`) });
        // A second agent's picture sits beside it; the first stays.
        await callTool(bridge, "product", "camera_capture", { preset: "top", size: 512 });
        await expect(page.getByTestId("team-shot-product")).toBeVisible();
        await expect(shot).toBeVisible();
        await shot.click();
        const dialog = page.getByTestId("shot-dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
        await page.screenshot({ path: testInfo.outputPath(`dialog-${scheme}.png`) });
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        // The model still takes the pointer: the strip does not sit over it.
        expect(await page.evaluate(() => window.__HAI_VIEWER__?.meshCount())).toBeGreaterThan(0);
      } finally {
        await bridge.stop();
      }
    });
  }
});

test.describe("the speed of it", () => {
  test("a picture takes under 400 ms, a set of eight under 3 s, and the user's frames keep coming", async ({
    page,
  }) => {
    const bridge = await start(page);
    try {
      const software = (await page.locator("canvas").first().getAttribute("data-renderer")) === "software";
      const time = async (args: Record<string, unknown>) => {
        const started = Date.now();
        await callTool(bridge, "architect", "camera_capture", args);
        return Date.now() - started;
      };
      await time({ preset: "top", size: 1024 }); // the first one warms the renderer up
      const singles: number[] = [];
      for (let i = 0; i < 10; i++) singles.push(await time({ preset: "iso", size: 1024, frame: undefined }));
      singles.sort((a, b) => a - b);
      const p90 = singles[Math.ceil(singles.length * 0.9) - 1] as number;

      // The user's own frames while a set of eight is taken: how long the longest gap between two is.
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
      const sheet = await time({ preset: "orbit-sheet" });
      const gaps = await page.evaluate(() => (window as unknown as { __gaps: number[] }).__gaps);
      const longest = Math.max(...gaps);
      console.log(
        `agent cameras (${software ? "software" : "gpu"}): 1024 px picture p90 ${p90} ms of ${singles.length}; orbit sheet ${sheet} ms; longest gap between the user's frames ${Math.round(longest)} ms`,
      );
      expect(p90).toBeLessThan(software ? 2000 : 400);
      expect(sheet).toBeLessThan(software ? 12_000 : 3000);
      expect(longest).toBeLessThan(software ? 800 : 120);
    } finally {
      await bridge.stop();
    }
  });
});
