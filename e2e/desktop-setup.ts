import { rmSync } from "node:fs";
import { join } from "node:path";
import { packageApp, stageApp } from "../apps/desktop/scripts/bundle.ts";
import { DESKTOP_APP_DIR, DESKTOP_PACKAGED_DIR, PACKAGED, TEST_APP_VERSION } from "./desktop.ts";
import { MODEL_SERVER_URL } from "./model-server.ts";

/**
 * Builds the desktop app once before the tests, with the web app's test hooks and the fake Claude Code CLI. For the
 * packaged target (HAI_DESKTOP_PACKAGED=1) the same folder is then packaged with electron-builder, so the tests run
 * the program the installer would install.
 */
export default async function stage(): Promise<void> {
  if (process.env.HAI_DESKTOP_EXE) return; // a build made elsewhere brings its own app
  const appDir = PACKAGED ? join(DESKTOP_PACKAGED_DIR, "app") : DESKTOP_APP_DIR;
  rmSync(PACKAGED ? DESKTOP_PACKAGED_DIR : DESKTOP_APP_DIR, { recursive: true, force: true });
  // The voice models are downloaded from a local server (e2e/model-server.ts), not from their pinned addresses.
  await stageApp(appDir, {
    manifest: true,
    version: TEST_APP_VERSION,
    testHooks: true,
    fakeClaude: true,
    modelsBaseUrl: MODEL_SERVER_URL,
  });
  if (PACKAGED) packageApp(appDir, join(DESKTOP_PACKAGED_DIR, "release"));
}
