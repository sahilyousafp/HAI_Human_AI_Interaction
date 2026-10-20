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

// One project per speech fixture in test-assets/speech (WAV, played once as Chromium's fake microphone), for the
// voice tests in e2e/voice/<fixture>.spec.ts.
const speechDir = join(import.meta.dirname, "test-assets", "speech");
const voiceProjects: Project[] = [
  "make-this-wall-300-thick",
  "architect-stair-core",
  "mochi-ask-climate",
  "mochi-status",
  "hey-mochi-status",
  "add-three-floors",
]
  .filter((fixture) => existsSync(join(import.meta.dirname, "e2e", "voice", `${fixture}.spec.ts`)))
  .map((fixture) => ({
    name: `voice:${fixture}`,
    testMatch: `voice/${fixture}.spec.ts`,
    // The speech model loads in each fresh browser context; CPU-only runners transcribe slowly.
    timeout: 120_000,
    use: {
      ...devices["Desktop Chrome"],
      channel,
      launchOptions: {
        args: [
          ...fakeCamera,
          `--use-file-for-fake-audio-capture=${join(speechDir, `${fixture}.wav`)}%noloop`,
        ],
      },
    },
  }));

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/warmup.ts",
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
      testIgnore: ["clips/**", "visual/**", "voice/**"],
      // Starting the camera loads MediaPipe in a fresh browser context each test (about 17 s on a CPU-only Windows
      // runner) and startCamera allows 45 s for frames, so the test needs more than the default 30 s.
      timeout: 60_000,
      use: { ...devices["Desktop Chrome"], channel, launchOptions: { args: fakeCamera } },
    },
    ...clipProjects,
    ...voiceProjects,
    // Screenshot baselines. Rendering is forced through software WebGL (SwiftShader) so a laptop GPU and a CI runner
    // draw the same pixels; baselines are recorded on Windows (fonts differ elsewhere), so the project runs there.
    ...(process.platform === "win32"
      ? [
          {
            name: "visual",
            testMatch: "visual/**",
            timeout: 60_000,
            use: {
              ...devices["Desktop Chrome"],
              channel,
              viewport: { width: 1280, height: 800 },
              launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
            },
            expect: {
              toHaveScreenshot: { maxDiffPixelRatio: 0.02, threshold: 0.25, animations: "disabled" as const },
            },
          },
        ]
      : []),
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
