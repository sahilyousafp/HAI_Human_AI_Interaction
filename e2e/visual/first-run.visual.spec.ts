import { expect, type Page, test } from "@playwright/test";
import type { ModelsState } from "../../packages/protocol/src/desktop.ts";

// The first-run screen for the voice models, in each state and both colour schemes. The page gets a stand-in for the
// desktop app (see e2e/first-run.spec.ts); the card alone is compared, not the blurred page behind it.

const ITEMS = [
  { id: "moonshine-base", bytes: 66_700_000 },
  { id: "kokoro", bytes: 326_600_000 },
];
const TOTAL = 393_300_000;

const STATES: Record<string, ModelsState> = {
  needed: { status: "needed", files: 14, totalBytes: TOTAL, items: ITEMS },
  downloading: {
    status: "downloading",
    file: "models/kokoro/onnx/model.onnx",
    fileNumber: 9,
    fileCount: 14,
    receivedBytes: 196_650_000,
    totalBytes: TOTAL,
    items: ITEMS,
  },
  failed: {
    status: "failed",
    reason: "offline",
    file: "models/kokoro/onnx/model.onnx",
    message: "x",
    files: 14,
    totalBytes: TOTAL,
    receivedBytes: 0,
    items: ITEMS,
  },
};

async function show(page: Page, state: ModelsState) {
  await page.addInitScript((first) => {
    (window as unknown as { haiDesktop: unknown }).haiDesktop = {
      models: {
        state: async () => first,
        start: async () => {},
        cancel: async () => {},
        onChange: () => () => {},
      },
    };
  }, state);
  await page.goto("/");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(400); // the progress bar settles
}

for (const scheme of ["light", "dark"] as const) {
  for (const name of Object.keys(STATES)) {
    test(`first run, ${name} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await show(page, STATES[name] as ModelsState);
      await expect(page.locator(".first-run-card")).toHaveScreenshot(`first-run-${name}-${scheme}.png`);
    });
  }
}

test("first run, voice is ready (light)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  // Seen working first, so the screen announces that it finished.
  await page.addInitScript((first) => {
    const listeners = new Set<(s: unknown) => void>();
    (window as unknown as { haiDesktop: unknown }).haiDesktop = {
      models: {
        state: async () => first,
        start: async () => {},
        cancel: async () => {},
        onChange: (l: (s: unknown) => void) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      },
    };
    (window as unknown as { __finish: () => void }).__finish = () => {
      for (const l of listeners) l({ status: "ready" });
    };
  }, STATES.downloading);
  await page.goto("/");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => (window as unknown as { __finish: () => void }).__finish());
  await expect(page.getByTestId("first-run-headline")).toHaveText("Voice is ready");
  await expect(page.locator(".first-run-card")).toHaveScreenshot("first-run-ready-light.png");
});
