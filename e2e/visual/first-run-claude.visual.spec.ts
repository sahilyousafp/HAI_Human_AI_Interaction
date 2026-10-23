import { expect, type Page, test } from "@playwright/test";
import type { ClaudeSetup, ClaudeState } from "../../packages/protocol/src/desktop.ts";

// The Claude Code step of the first-run screen, in each state and both colour schemes. The page gets a stand-in for the
// desktop app (see e2e/first-run-claude.spec.ts); the card alone is compared, not the blurred page behind it.

const INFO = {
  command: "irm https://claude.ai/install.ps1 | iex",
  source: "https://claude.ai/install.ps1",
  instructionsUrl: "https://code.claude.com/docs/en/setup",
};
const setup = (state: ClaudeState): ClaudeSetup => ({ state, prerequisites: [], info: INFO });

const STATES: Record<string, ClaudeSetup> = {
  missing: setup({ status: "missing" }),
  installing: setup({
    status: "installing",
    output: [
      "Downloading Claude Code...",
      "Verifying the download...",
      "Installing to C:\\Users\\you\\.local\\bin",
    ],
  }),
  failed: setup({
    status: "install-failed",
    output: ["Access to the path is denied"],
    message: "The installer stopped with an error (exit code 2).",
  }),
  "signed-out": setup({ status: "signed-out" }),
  "signing-in": setup({ status: "signing-in" }),
  ready: setup({ status: "ready", version: "2.1.303" }),
};

async function show(page: Page, claude: ClaudeSetup, ready: boolean) {
  await page.addInitScript(
    ({ first, ready: isReady }) => {
      const claudeListeners = new Set<(s: unknown) => void>();
      (window as unknown as { haiDesktop: unknown }).haiDesktop = {
        models: {
          state: async () => ({ status: "ready" }),
          start: async () => {},
          cancel: async () => {},
          onChange: () => () => {},
        },
        claude: {
          // A ready state is shown as the end of a step that had work to do.
          state: async () => (isReady ? { ...first, state: { status: "missing" } } : first),
          recheck: async () => first,
          install: async () => {},
          openSignIn: async () => {},
          onChange: (l: (s: unknown) => void) => {
            claudeListeners.add(l);
            return () => claudeListeners.delete(l);
          },
        },
      };
      (window as unknown as { __finish: () => void }).__finish = () => {
        for (const l of claudeListeners) l(first);
      };
    },
    { first: claude, ready },
  );
  await page.goto("/");
  await expect(page.getByRole("dialog")).toBeVisible();
  if (ready) await page.evaluate(() => (window as unknown as { __finish: () => void }).__finish());
  await page.waitForTimeout(400);
}

for (const scheme of ["light", "dark"] as const) {
  for (const name of Object.keys(STATES)) {
    test(`first run, Claude Code ${name} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await show(page, STATES[name] as ClaudeSetup, name === "ready");
      await expect(page.locator(".first-run-card")).toHaveScreenshot(
        `first-run-claude-${name}-${scheme}.png`,
      );
    });
  }
}
