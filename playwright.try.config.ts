import { defineConfig, devices } from "@playwright/test";

// The Try now site (the app with its own scene in the page, served under /try/): its own build and static server, no
// bridge. Run with `pnpm test:e2e:try`.
const isCI = Boolean(process.env.CI);
const channel = process.env.HAI_E2E_CHANNEL ?? (isCI ? undefined : "msedge");
const PORT = 4174;

export default defineConfig({
  testDir: "e2e-try",
  timeout: 60_000,
  expect: { timeout: isCI ? 15_000 : 5_000 },
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    channel,
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--site-per-process"],
    },
  },
  projects: [{ name: "try" }],
  webServer: {
    command: "pnpm --filter @hai/web build:try && pnpm --filter @hai/web preview:try",
    url: `http://127.0.0.1:${PORT}/try/`,
    reuseExistingServer: !isCI,
    timeout: 240_000,
  },
});
