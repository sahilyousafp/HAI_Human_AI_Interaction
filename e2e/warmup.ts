import { chromium, type FullConfig } from "@playwright/test";

/**
 * Loads the app once before any test, and runs tracking once. Vite bundles dependencies (three.js, drei,
 * MediaPipe) lazily on the first page load, and the first camera start compiles MediaPipe's WebAssembly and loads
 * its models; on a CPU-only CI runner each can take tens of seconds, and without this whichever test runs first
 * pays that cost and can time out.
 *
 * It also prints what the machine gives tracking (WebGL renderer, delegate, frame rate), which is what to look at
 * first when tracking tests fail on one platform only.
 */
export default async function warmup(config: FullConfig): Promise<void> {
  const project = config.projects[0];
  const baseURL = project?.use.baseURL ?? "http://127.0.0.1:5173";
  const browser = await chromium.launch({
    channel: project?.use.channel,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(baseURL);
    await page.waitForFunction(
      () => (window as { __AEX_VIEWER__?: unknown }).__AEX_VIEWER__ !== undefined,
      null,
      { timeout: 180_000 },
    );
    const gpu = await page.evaluate(() => {
      const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
      if (!gl) return { renderer: "no WebGL2", unmasked: null, cores: navigator.hardwareConcurrency };
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        renderer: String(gl.getParameter(gl.RENDERER)),
        unmasked: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null,
        cores: navigator.hardwareConcurrency,
      };
    });
    console.log(
      `[warmup] WebGL renderer: ${gpu.unmasked ?? "(unmasked name unavailable)"} / ${gpu.renderer}; ` +
        `viewer mode: ${await page.getByTestId("viewer").locator("[data-renderer]").first().getAttribute("data-renderer")}; ` +
        `CPU cores: ${gpu.cores}`,
    );

    const started = Date.now();
    await page.getByTestId("camera-toggle").click();
    const frameCount = () =>
      page.evaluate(
        () => (window as { __AEX_TRACKING__?: { frames: unknown[] } }).__AEX_TRACKING__?.frames.length ?? 0,
      );
    while ((await frameCount()) < 10 && Date.now() - started < 180_000) await page.waitForTimeout(500);
    const firstFrames = Date.now() - started;
    await page.waitForTimeout(3000); // let the once-per-second HUD readouts settle
    const hud = async (id: string) => (await page.getByTestId(id).textContent())?.trim();
    console.log(
      `[warmup] tracking: 10 frames after ${(firstFrames / 1000).toFixed(1)} s; ` +
        `backend ${await hud("hud-backend")}, ${await hud("hud-fps")}, inference ${await hud("hud-inference")}, ` +
        `frames/dropped ${await hud("hud-frames")}`,
    );
  } finally {
    await browser.close();
  }
}
