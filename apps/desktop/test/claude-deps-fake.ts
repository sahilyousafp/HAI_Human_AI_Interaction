import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeSetupOptions } from "../src/setup/claude.ts";

// A stand-in for src/setup/claude-deps.ts in the end-to-end tests: Claude Code as a few files in FAKE_CLAUDE_STATE.
//   HAI_FAKE_CLAUDE_START   where it starts: "ready" (the default), "signed-out" (installed, no account) or "missing"
//   HAI_FAKE_INSTALL_FAILS  "1": the installer exits with an error the first time it is run
// A test moves it on by writing files, as the real world would: `signed-in` (an account appeared). The installer writes
// `installed` when it finishes, and the sign-in window writes `signin-opened` so a test can see it was asked for.
const dir = () => process.env.FAKE_CLAUDE_STATE ?? process.cwd();
const start = () => process.env.HAI_FAKE_CLAUDE_START ?? "ready";
const has = (name: string) => existsSync(join(dir(), name));
const mark = (name: string, text = "1") => {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(join(dir(), name), text);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const claudeDeps: Pick<
  ClaudeSetupOptions,
  "detect" | "runInstaller" | "findExecutable" | "openTerminal"
> = {
  async detect() {
    const installed = start() !== "missing" || has("installed");
    if (!installed)
      return { ok: false, reason: "missing", message: "Claude Code is not installed.", fix: "x" };
    const signedIn = start() === "ready" || has("signed-in");
    if (!signedIn)
      return { ok: false, reason: "logged-out", message: "Claude Code is not logged in.", fix: "x" };
    return { ok: true, version: "2.1.303", executable: "fake-claude" };
  },
  async runInstaller(onLine) {
    mark("installer-ran");
    for (const line of ["Downloading Claude Code...", "Verifying the download...", "Installing..."]) {
      onLine(line);
      await sleep(250);
    }
    if (process.env.HAI_FAKE_INSTALL_FAILS === "1" && !has("install-failed-once")) {
      mark("install-failed-once");
      onLine("Access to the path is denied");
      return { code: 2 };
    }
    mark("installed");
    return { code: 0 };
  },
  async findExecutable() {
    return start() !== "missing" || has("installed") ? "fake-claude" : null;
  },
  async openTerminal() {
    mark("signin-opened");
  },
};
