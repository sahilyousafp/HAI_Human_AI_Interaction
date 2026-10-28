import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { PythonEnv } from "../apps/bridge/src/python/python-env.ts";
import { type Bridge, type BridgeOptions, createBridge } from "../apps/bridge/src/server.ts";
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
  options: {
    agent?: AgentProvider;
    speak?: boolean;
    /** A ready Python environment, so a test that runs Python does not install one. */
    pythonEnv?: PythonEnv;
    /** The folder to work in (settings, project, mirror), to start a second bridge on the same workspace. */
    root?: string;
    /** A local stand-in for the open-data hosts (their real addresses are never contacted in tests). */
    openData?: BridgeOptions["openData"];
  } = {},
): Promise<Bridge & { port: number }> {
  const port = nextPort++;
  const token = `viewer-e2e-${port}-0123456789`;
  const root = options.root ?? mkdtempSync(join(tmpdir(), "hai-e2e-"));
  const projectDir = join(root, "project");
  mkdirSync(join(root, ".hai"), { recursive: true });
  const settingsFile = join(root, ".hai", "settings.json");
  // A workspace that is started again keeps its settings.
  if (!existsSync(settingsFile))
    writeFileSync(settingsFile, JSON.stringify({ speakReplies: options.speak ?? false }));
  const bridge = createBridge({
    host: "127.0.0.1",
    port,
    allowedOrigins: E2E_ORIGINS,
    version: "e2e",
    token,
    scene: { projectDir, saveDelayMs: 200 },
    settingsFile,
    mirrorDir: join(root, "mirror"),
    ...(options.pythonEnv ? { pythonEnv: options.pythonEnv } : {}),
    ...(options.openData ? { openData: options.openData } : {}),
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
  // Let the camera settle on its initial framing: wait until it has not moved for 400 ms (a fixed wait was too short on a
  // slow frame, and a screenshot of the model then differed by a pixel from run to run).
  let last = "";
  let unchanged = 0;
  for (let i = 0; i < 100 && unchanged < 4; i++) {
    await page.waitForTimeout(100);
    const now = JSON.stringify(await camera(page));
    unchanged = now === last ? unchanged + 1 : 0;
    last = now;
  }
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
    // A coarse scan finds anything of size; a thin element (a column seen from a distance) needs a finer one.
    const scan = (step: number) => {
      const found: [number, number][] = [];
      for (let y = 0.05; y < 1; y += step) {
        for (let x = 0.05; x < 1; x += step) {
          if (window.__HAI_VIEWER__?.pick(x, y) === id && visible(x, y)) found.push([x, y]);
        }
      }
      return found;
    };
    const coarse = scan(0.025);
    const hits = coarse.length > 0 ? coarse : scan(0.008);
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
