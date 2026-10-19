import type { Page, TestInfo } from "@playwright/test";

/**
 * Counts overlay-canvas pixels close to each CSS colour token, so overlay tests check what was drawn
 * without pixel-exact screenshots (which differ across platforms and video frames).
 */
export async function overlayColorCounts(page: Page, tokens: string[]): Promise<Record<string, number>> {
  return page.evaluate((names) => {
    const canvas = document.querySelector<HTMLCanvasElement>(".preview-overlay");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return {};
    const probe = document.createElement("canvas").getContext("2d");
    const css = getComputedStyle(canvas);
    const targets = names.map((name) => {
      // Let the browser parse any CSS colour syntax by painting it onto a 1x1 canvas.
      if (!probe) return { name, rgb: [0, 0, 0] };
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = css.getPropertyValue(name).trim();
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      return { name, rgb: [r ?? 0, g ?? 0, b ?? 0] };
    });
    const counts: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) < 200) continue; // ignore transparent and anti-aliased edge pixels
      for (const t of targets) {
        const d =
          Math.abs((data[i] ?? 0) - (t.rgb[0] ?? 0)) +
          Math.abs((data[i + 1] ?? 0) - (t.rgb[1] ?? 0)) +
          Math.abs((data[i + 2] ?? 0) - (t.rgb[2] ?? 0));
        if (d < 30) counts[t.name] = (counts[t.name] ?? 0) + 1;
      }
    }
    return counts;
  }, tokens);
}

/** Attaches a screenshot of the preview for human review in the test report. */
export async function attachPreview(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, {
    body: await page.locator(".preview").screenshot(),
    contentType: "image/png",
  });
}
