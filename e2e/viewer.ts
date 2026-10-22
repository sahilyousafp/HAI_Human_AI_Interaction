import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { type Bridge, createBridge } from "../apps/bridge/src/server.ts";
import type { AgentProvider } from "../packages/agent-core/src/index.ts";
import { E2E_ORIGINS } from "./stack.ts";

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
  /** `speak`: Mochi's replies are spoken (off in other tests, so they do not load the 325 MB voice). */
  options: { agent?: AgentProvider; speak?: boolean } = {},
): Promise<Bridge & { port: number }> {
  const port = nextPort++;
  const token = `viewer-e2e-${port}-0123456789`;
  const root = mkdtempSync(join(tmpdir(), "hai-e2e-"));
  const projectDir = join(root, "project");
  mkdirSync(join(root, ".hai"), { recursive: true });
  writeFileSync(
    join(root, ".hai", "settings.json"),
    JSON.stringify({ speakReplies: options.speak ?? false }),
  );
  const bridge = createBridge({
    host: "127.0.0.1",
    port,
    allowedOrigins: E2E_ORIGINS,
    version: "e2e",
    token,
    scene: { projectDir, saveDelayMs: 200 },
    settingsFile: join(root, ".hai", "settings.json"),
    ...(options.agent ? { agent: { provider: options.agent } } : {}),
  });
  await bridge.start();
  await page.addInitScript(
    ({ port, token }) => {
      Object.defineProperty(window, "__HAI_SESSION__", { value: { port, token }, writable: false });
    },
    { port, token },
  );
  return Object.assign(bridge, { port });
}

export async function openViewer(page: Page): Promise<void> {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => window.__HAI_VIEWER__?.meshCount() ?? 0), { timeout: 30_000 })
    .toBeGreaterThan(0);
  // Let the camera settle on its initial framing.
  await page.waitForTimeout(400);
}

export const camera = (page: Page) => page.evaluate(() => window.__HAI_VIEWER__?.camera() as Camera);

/** Finds a viewer position (0..1) where the given element is hit and not covered by a HUD panel, by scanning a grid. */
export async function findElementOnScreen(page: Page, elementId: string): Promise<[number, number]> {
  const hit = await page.evaluate((id) => {
    const rect = document.querySelector("[data-testid=viewer] canvas")?.getBoundingClientRect();
    const canvasAt = (px: number, py: number) => document.elementFromPoint(px, py)?.tagName === "CANVAS";
    // Clear of HUD panels by a margin, so a panel that grows a little (a status line appearing) does not cover it.
    const visible = (x: number, y: number) => {
      if (!rect) return false;
      const px = rect.left + x * rect.width;
      const py = rect.top + y * rect.height;
      return [
        [0, 0],
        [0, 60],
        [0, -60],
        [60, 0],
        [-60, 0],
      ].every(([dx = 0, dy = 0]) => canvasAt(px + dx, py + dy));
    };
    const hits: [number, number][] = [];
    for (let y = 0.05; y < 1; y += 0.025) {
      for (let x = 0.05; x < 1; x += 0.025) {
        if (window.__HAI_VIEWER__?.pick(x, y) === id && visible(x, y)) hits.push([x, y]);
      }
    }
    if (hits.length === 0) return null;
    // The middle of what is visible, not an edge a HUD panel may grow over a moment later.
    const cx = hits.reduce((s, h) => s + h[0], 0) / hits.length;
    const cy = hits.reduce((s, h) => s + h[1], 0) / hits.length;
    const distance = (h: [number, number]) => (h[0] - cx) ** 2 + (h[1] - cy) ** 2;
    return hits.reduce((best, h) => (distance(h) < distance(best) ? h : best));
  }, elementId);
  if (!hit) throw new Error(`${elementId} is not visible`);
  return hit as [number, number];
}

/**
 * The pinch point (camera frame) that puts a hand's pointer on a viewer position. Hands span the whole workspace
 * (the model and the sidebar), so the viewer works out the inverse from the page's layout.
 */
export const handAt = (page: Page, [x, y]: [number, number]): Promise<[number, number]> =>
  page.evaluate(
    ([vx, vy]) => {
      const at = window.__HAI_VIEWER__?.handAt(vx, vy);
      if (!at) throw new Error("the viewer is not ready");
      return at;
    },
    [x, y] as const,
  );

export const now = (page: Page) => page.evaluate(() => performance.timeOrigin + performance.now());
