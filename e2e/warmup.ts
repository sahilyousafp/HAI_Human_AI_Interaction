import { chromium, type FullConfig } from "@playwright/test";

/**
 * Loads the app once before any test. Vite bundles dependencies (three.js, drei, MediaPipe) lazily on the first
 * page load, which can take tens of seconds on a CPU-only CI runner; without this, whichever test runs first
 * pays that cost and can time out.
 */
export default async function warmup(config: FullConfig): Promise<void> {
  const project = config.projects[0];
  const baseURL = project?.use.baseURL ?? "http://127.0.0.1:5173";
  const browser = await chromium.launch({ channel: project?.use.channel });
  try {
    const page = await browser.newPage();
    await page.goto(baseURL);
    await page.waitForFunction(
      () => (window as { __AEX_VIEWER__?: unknown }).__AEX_VIEWER__ !== undefined,
      null,
      {
        timeout: 180_000,
      },
    );
    // Let Vite transform the perception worker too (fetched, not executed).
    await page.evaluate(() =>
      fetch("/src/perception/perception.worker.ts?worker_file&type=module").then((r) => r.text()),
    );
  } finally {
    await browser.close();
  }
}
