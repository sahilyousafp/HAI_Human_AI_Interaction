import type { Page } from "@playwright/test";

/**
 * Timing budgets are for a quiet reference laptop. A shared CI runner (CPU only, other jobs beside it) is several times
 * slower, so a test that measures time takes its limit from here: `allow(local, ci)`.
 */
export const onCi = Boolean(process.env.CI);

export const allow = (local: number, ci: number): number => (onCi ? ci : local);

/**
 * Whether the viewer draws in software (a machine with no GPU): it leaves shadows out and is far slower. The mode sits on
 * the wrapper r3f puts around the canvas, not on the canvas itself.
 */
export async function drawsInSoftware(page: Page): Promise<boolean> {
  return (
    (await page.getByTestId("viewer").locator("[data-renderer]").first().getAttribute("data-renderer")) ===
    "software"
  );
}
