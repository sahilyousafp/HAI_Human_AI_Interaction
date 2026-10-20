import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { type Bridge, createBridge } from "../apps/bridge/src/server.ts";
import type { AgentProvider } from "../packages/agent-core/src/index.ts";

export type Camera = {
  target: [number, number, number];
  azimuth: number;
  elevation: number;
  distance: number;
};

let nextPort = 4900;

/**
 * Starts a private bridge with a throwaway project folder and pins the page to it, so viewer tests never touch
 * the developer's own project and can stop the bridge mid-test.
 */
export async function startTestBridge(
  page: Page,
  options: { agent?: AgentProvider } = {},
): Promise<Bridge & { port: number }> {
  const port = nextPort++;
  const token = `viewer-e2e-${port}-0123456789`;
  const root = mkdtempSync(join(tmpdir(), "aex-e2e-"));
  const projectDir = join(root, "project");
  const bridge = createBridge({
    host: "127.0.0.1",
    port,
    allowedOrigins: ["http://127.0.0.1:5173", "http://localhost:5173"],
    version: "e2e",
    token,
    scene: { projectDir, saveDelayMs: 200 },
    settingsFile: join(root, ".aex", "settings.json"),
    ...(options.agent ? { agent: { provider: options.agent } } : {}),
  });
  await bridge.start();
  await page.addInitScript(
    ({ port, token }) => {
      Object.defineProperty(window, "__AEX_SESSION__", { value: { port, token }, writable: false });
    },
    { port, token },
  );
  return Object.assign(bridge, { port });
}

export async function openViewer(page: Page): Promise<void> {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => window.__AEX_VIEWER__?.meshCount() ?? 0), { timeout: 30_000 })
    .toBeGreaterThan(0);
  // Let the camera settle on its initial framing.
  await page.waitForTimeout(400);
}

export const camera = (page: Page) => page.evaluate(() => window.__AEX_VIEWER__?.camera() as Camera);

/** Finds a viewer position (0..1) where the given element is hit and not covered by a HUD panel, by scanning a grid. */
export async function findElementOnScreen(page: Page, elementId: string): Promise<[number, number]> {
  const hit = await page.evaluate((id) => {
    const rect = document.querySelector("[data-testid=viewer] canvas")?.getBoundingClientRect();
    const visible = (x: number, y: number) =>
      rect &&
      document.elementFromPoint(rect.left + x * rect.width, rect.top + y * rect.height)?.tagName === "CANVAS";
    for (let y = 0.05; y < 1; y += 0.025) {
      for (let x = 0.05; x < 1; x += 0.025) {
        if (window.__AEX_VIEWER__?.pick(x, y) === id && visible(x, y)) return [x, y];
      }
    }
    return null;
  }, elementId);
  if (!hit) throw new Error(`${elementId} is not visible`);
  return hit as [number, number];
}

/** Hand pointer coordinates that land on a viewer position (inverse of the viewer's pointer gain). */
export const handAt = ([x, y]: [number, number]): [number, number] => [
  0.5 + (x - 0.5) / 1.3,
  0.5 + (y - 0.5) / 1.3,
];

export const now = (page: Page) => page.evaluate(() => performance.timeOrigin + performance.now());
