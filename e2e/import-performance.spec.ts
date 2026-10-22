import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// A model of 1000 objects (the most an import keeps as separate elements) must not stall the page while it comes in,
// and the view must keep up with the hands afterwards.
const ROOT = join(import.meta.dirname, "..");
const BIG = join(ROOT, ".aex", "models", "grid-1000.3dm");

let bridge: (Bridge & { port: number }) | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

test.beforeAll(() => {
  execFileSync(process.execPath, [join(ROOT, "scripts", "make-3dm-fixtures.mjs"), "--big"], {
    stdio: "ignore",
  });
});

const importedCount = (page: Page) =>
  page.evaluate(
    () =>
      Object.values(window.__AEX_SCENE__?.getSnapshot().doc?.elements ?? {}).filter(
        (e) => e.type === "imported",
      ).length,
  );

test("1000 imported objects: the page never stalls long, and orbiting stays within the latency target", async ({
  page,
}) => {
  test.setTimeout(120_000);
  bridge = await startTestBridge(page);
  await openViewer(page);

  // Long tasks (over 50 ms on the page's main thread) from now on.
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__long.push(Math.round(entry.duration));
    }).observe({ type: "longtask", buffered: false });
  });

  await page.getByTestId("import-input").setInputFiles(BIG);
  await expect(page.getByTestId("import-summary")).toContainText("Imported 1000 objects", {
    timeout: 60_000,
  });
  await expect.poll(() => importedCount(page), { timeout: 30_000 }).toBe(1000);
  // Every box has its triangles: one is pickable on screen.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          for (let y = 0.05; y < 1; y += 0.025) {
            for (let x = 0.05; x < 1; x += 0.025) {
              if (window.__AEX_VIEWER__?.pick(x, y)?.startsWith("imp-")) return true;
            }
          }
          return false;
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.waitForTimeout(1000);

  const longTasks = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  console.log(`long tasks during the import (ms): ${JSON.stringify(longTasks)}`);
  // Nothing may hold the page for a full second: the hands and the view stay alive.
  expect(Math.max(0, ...longTasks)).toBeLessThan(1000);

  // Orbit by hand and read the gesture-to-render time the status bar shows.
  await page.evaluate(() => window.__AEX_INPUT__?.engaged(true));
  for (let i = 0; i < 40; i++) {
    await page.evaluate((i) => {
      const x = 0.4 + i * 0.004;
      const type = i === 0 ? "pinch.drag.start" : "pinch.drag.update";
      // Stamped as the camera would: when the frame was captured, which is now.
      const ts = performance.timeOrigin + performance.now();
      window.__AEX_INPUT__?.gestures([
        { type, ts, confidence: 1, hand: "Right", position: [x, 0.5], delta: [0.004, 0] },
      ]);
    }, i);
    await page.waitForTimeout(33);
  }
  const p90 = await page.evaluate(() => window.__AEX_VIEWER__?.latencyP90() ?? null);
  console.log(`gesture to render p90 with 1000 imported objects: ${p90} ms`);
  expect(p90).not.toBeNull();
  expect(p90 as number).toBeLessThan(100);
});
