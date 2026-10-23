import { defineConfig } from "@playwright/test";

// The installed app: Electron driven by Playwright, with Chromium's fake camera and the fake Claude Code CLI. It
// starts its own bridge and serves its own pages, so no dev server is needed. HAI_DESKTOP_EXE tests a packaged build.
export default defineConfig({
  testDir: "e2e",
  testMatch: "desktop*.spec.ts",
  globalSetup: "./e2e/desktop-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 90_000,
  use: { trace: "retain-on-failure" },
});
