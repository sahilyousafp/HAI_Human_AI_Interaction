import { expect, type Page, test } from "@playwright/test";
import type { UpdateState } from "../../packages/protocol/src/desktop.ts";
import { openSettings } from "../settings.ts";

// The update controls in Settings > Setup, in each state and both colour schemes, and the pill in the top bar. The page gets
// a stand-in for the desktop app (see e2e/updates.spec.ts).

const state = (rest: object): UpdateState => ({ current: "1.0.0", autoCheck: true, ...rest }) as UpdateState;

const STATES: Record<string, UpdateState> = {
  idle: state({ status: "idle", checkedAt: "2026-10-23T10:00:00.000Z" }),
  available: state({ status: "available", version: "1.1.0" }),
  downloading: state({ status: "downloading", version: "1.1.0", percent: 42 }),
  ready: state({ status: "ready", version: "1.1.0", canRestart: true }),
  waiting: state({ status: "ready", version: "1.1.0", canRestart: false }),
  error: state({
    status: "error",
    message:
      "The update could not be installed: sha512 checksum mismatch. HAI 1.0.0 is still installed and works as before.",
  }),
};

async function show(page: Page, update: UpdateState) {
  await page.addInitScript((first) => {
    const ready = { status: "ready" };
    (window as unknown as { haiDesktop: unknown }).haiDesktop = {
      models: {
        state: async () => ready,
        start: async () => {},
        cancel: async () => {},
        onChange: () => () => {},
      },
      claude: {
        state: async () => ({
          state: { status: "ready", version: "2.1.303" },
          prerequisites: [],
          info: { command: "", source: "", instructionsUrl: "" },
        }),
        recheck: async () => ({}),
        install: async () => {},
        openSignIn: async () => {},
        onChange: () => () => {},
      },
      updates: {
        state: async () => first,
        check: async () => {},
        download: async () => {},
        restart: async () => true,
        setBusy: async () => {},
        setAutoCheck: async () => {},
        onChange: () => () => {},
      },
    };
  }, update);
  await page.goto("/");
  await openSettings(page, "setup");
  await page.waitForTimeout(600); // the sheet settles
}

for (const scheme of ["light", "dark"] as const) {
  for (const name of Object.keys(STATES)) {
    test(`updates, ${name} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await show(page, STATES[name] as UpdateState);
      await expect(page.getByTestId("setup-updates")).toHaveScreenshot(`updates-${name}-${scheme}.png`);
    });
  }
}

test("the update pill in the top bar", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    const ready = { status: "ready" };
    (window as unknown as { haiDesktop: unknown }).haiDesktop = {
      models: {
        state: async () => ready,
        start: async () => {},
        cancel: async () => {},
        onChange: () => () => {},
      },
      updates: {
        state: async () => ({ current: "1.0.0", autoCheck: true, status: "available", version: "1.1.0" }),
        check: async () => {},
        download: async () => {},
        restart: async () => true,
        setBusy: async () => {},
        setAutoCheck: async () => {},
        onChange: () => () => {},
      },
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("update-pill")).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator(".pills")).toHaveScreenshot("update-pill.png");
});
