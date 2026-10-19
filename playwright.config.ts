import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices, type Project } from "@playwright/test";
import { buildClips } from "./scripts/convert-clips.mjs";

const isCI = Boolean(process.env.CI);

// Chromium's fake camera lets tracking tests run without a person or a webcam.
const fakeCamera = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
const channel = process.env.AEX_E2E_CHANNEL ?? (isCI ? undefined : "msedge"); // locally, drive installed Edge

// One project per recorded clip in test-assets/clips (MP4 in git, .y4m generated into .aex/clips).
// A clip project exists only when its recording does, so missing clips never show up as skipped tests.
const clipDir = join(import.meta.dirname, ".aex", "clips");
const clipProjects: Project[] = buildClips(clipDir)
  .filter((clip: string) => existsSync(join(import.meta.dirname, "e2e", "clips", `${clip}.spec.ts`)))
  .map((clip: string) => ({
    name: `clip:${clip}`,
    testMatch: `clips/${clip}.spec.ts`,
    // CPU-only CI runners process a few frames per second; clip tests wait for enough of them.
    timeout: 120_000,
    use: {
      ...devices["Desktop Chrome"],
      channel,
      launchOptions: {
        args: [...fakeCamera, `--use-file-for-fake-video-capture=${join(clipDir, `${clip}.y4m`)}`],
      },
    },
  }));

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "clips/**",
      use: { ...devices["Desktop Chrome"], channel, launchOptions: { args: fakeCamera } },
    },
    ...clipProjects,
  ],
  webServer: [
    {
      command: "pnpm --filter @aex/bridge start",
      url: "http://127.0.0.1:4870/health",
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @aex/web dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
  ],
});
