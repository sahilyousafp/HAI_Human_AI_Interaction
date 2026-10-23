import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, expect, type Page } from "@playwright/test";

/** Where `desktop-setup.ts` stages the app for the tests: package.json and dist/ with the test hooks and fake Claude. */
export const DESKTOP_APP_DIR = join(import.meta.dirname, "..", ".hai", "desktop-e2e", "app");

/** The version the staged and packaged test app reports. Not 0.0.0, so a version written into the code instead of read from the app shows up. */
export const TEST_APP_VERSION = "3.2.1";

/** HAI_DESKTOP_PACKAGED=1 runs the tests against the program electron-builder makes, not the staged folder. */
export const PACKAGED = process.env.HAI_DESKTOP_PACKAGED === "1";
export const DESKTOP_PACKAGED_DIR = join(import.meta.dirname, "..", ".hai", "desktop-e2e-packaged");

/** The program under test when it is packaged (or made elsewhere), else null: Electron runs the staged folder. */
const packagedExe: string | null =
  process.env.HAI_DESKTOP_EXE ??
  (PACKAGED ? join(DESKTOP_PACKAGED_DIR, "release", "win-unpacked", "HAI.exe") : null);
/** Whether the app under test is an installed-style build (its `app.isPackaged` is true). */
export const isPackagedTarget = packagedExe !== null;

const electronPath: string = createRequire(
  join(import.meta.dirname, "..", "apps", "desktop", "package.json"),
)("electron");
const clipDir = join(import.meta.dirname, "..", ".hai", "clips");

export interface Desktop {
  app: ElectronApplication;
  page: Page;
  /** The app's data folder (Electron's userData), a fresh one per launch. */
  userData: string;
  /** Where the fake Claude Code CLI records the processes it starts. */
  fakeClaudeState: string;
  /** The bridge's process id, from its session file. */
  bridgePid(): number | null;
  /** The process ids of every agent process the fake CLI started. */
  agentPids(): number[];
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** A recorded clip from `.hai/clips` to play as the fake camera (without the `.y4m`). */
  clip?: string;
  env?: Record<string, string>;
  /** Keep this folder as the app's data folder instead of making a fresh one. */
  userData?: string;
  /**
   * Leave the first-run screens as they are. By default the harness waits for the app to finish looking at what is
   * installed and skips whatever the screens ask, so a test about something else is not covered by them.
   */
  keepSetup?: boolean;
  /** Files to leave in the fake Claude folder before the app starts (the fake release feed reads them). */
  fakeFiles?: Record<string, string>;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};
export const isAlive = alive;

/** The program and arguments that start the desktop app under test (a packaged build, or the staged folder). */
function appCommand(userData: string, clip?: string): { file: string; args: string[] } {
  return {
    file: packagedExe ?? electronPath,
    args: [
      ...(packagedExe ? [] : [DESKTOP_APP_DIR]),
      `--user-data-dir=${userData}`,
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      ...(clip ? [`--use-file-for-fake-video-capture=${join(clipDir, `${clip}.y4m`)}`] : []),
    ],
  };
}

/** Starts the app a second time on the same data folder and resolves with how it ended, and how fast. */
export function launchSecondInstance(userData: string): Promise<{ code: number | null; ms: number }> {
  const command = appCommand(userData);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { stdio: "ignore", env: process.env });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The second instance did not exit."));
    }, 20_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, ms: Date.now() - started });
    });
  });
}

/** Waits until the app has looked at the voice models and Claude Code, then skips every first-run step that is showing. */
async function skipFirstRun(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      const api = (
        window as unknown as {
          haiDesktop?: {
            models: { state(): Promise<{ status: string }> };
            claude?: { state(): Promise<{ state: { status: string } }> };
          };
        }
      ).haiDesktop;
      if (!api) return true;
      const models = await api.models.state();
      const claude = api.claude ? (await api.claude.state()).state.status : "ready";
      return models.status !== "checking" && claude !== "checking";
    },
    null,
    { timeout: 30_000 },
  );
  const screen = page.getByTestId("first-run");
  // The screen is drawn a moment after the state is known.
  await page.waitForTimeout(300);
  for (let i = 0; i < 4 && (await screen.count()) > 0; i++) {
    const skip = page.getByTestId("first-run-action-skip");
    const next = (await skip.count()) > 0 ? skip : page.getByTestId("first-run-action-continue");
    await next.click();
    await page.waitForTimeout(200);
  }
}

/** Starts the staged desktop app with Chromium's fake camera and the fake Claude Code CLI, and waits for its window. */
export async function launchDesktop(options: LaunchOptions = {}): Promise<Desktop> {
  const userData = options.userData ?? mkdtempSync(join(tmpdir(), "hai-desktop-e2e-"));
  const fakeClaudeState = join(userData, "fake-claude");
  mkdirSync(fakeClaudeState, { recursive: true });
  for (const [name, text] of Object.entries(options.fakeFiles ?? {})) {
    writeFileSync(join(fakeClaudeState, name), text);
  }
  const command = appCommand(userData, options.clip);
  const app = await _electron.launch({
    executablePath: command.file,
    args: command.args,
    env: { ...process.env, FAKE_CLAUDE_STATE: fakeClaudeState, ...options.env } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="bridge-status"]', { timeout: 30_000 });
  if (!options.keepSetup) await skipFirstRun(page);
  return {
    app,
    page,
    userData,
    fakeClaudeState,
    bridgePid() {
      try {
        return JSON.parse(readFileSync(join(userData, ".hai", "session.json"), "utf8")).pid as number;
      } catch {
        return null;
      }
    },
    agentPids() {
      try {
        return readdirSync(fakeClaudeState)
          .filter((f) => f.startsWith("start-"))
          .map((f) => JSON.parse(readFileSync(join(fakeClaudeState, f), "utf8")).pid as number);
      } catch {
        return [];
      }
    },
    async close() {
      await app.close().catch(() => {});
    },
  };
}

/** Removes a data folder; Windows can hold a file for a moment after the process that used it has exited. */
export function removeUserData(userData: string): void {
  try {
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // left to the system's temp cleaning
  }
}

/** The web app's dev server on its own port, for tests of the desktop shell run from the repository. */
export async function startWebDevServer(port: number): Promise<{ url: string; stop(): Promise<void> }> {
  const webRoot = join(import.meta.dirname, "..", "apps", "web");
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(webRoot, "node_modules", "vite", "bin", "vite.js")], {
    cwd: webRoot,
    env: { ...process.env, HAI_WEB_PORT: String(port) },
    stdio: "ignore",
  });
  const stop = async () => {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  };
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(url)).ok) return { url, stop };
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await stop();
  throw new Error(`The web dev server did not answer on ${url}.`);
}

export const bridgeConnected = (page: Page) =>
  expect(page.getByTestId("bridge-status")).toHaveAttribute("data-state", "connected", { timeout: 20_000 });
