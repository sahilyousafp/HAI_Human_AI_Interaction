import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Detection } from "../provider.ts";
import { run as defaultRun, type Run } from "./run.ts";

export const INSTALL_URL = "https://docs.anthropic.com/en/docs/claude-code/setup";

/**
 * The folder the official Claude Code installer puts `claude` in for the current user. The installer does not add it
 * to the PATH, so a copy installed while HAI is running is found here, without a restart.
 */
export function claudeInstallFolder(home: string = homedir()): string {
  return join(home, ".local", "bin");
}

/** The executable the official installer leaves in that folder. */
export function claudeInstallPath(platform: string = process.platform, home: string = homedir()): string {
  return join(claudeInstallFolder(home), platform === "win32" ? "claude.exe" : "claude");
}

/** The parts of the machine detection looks at besides running programs. Injected in tests. */
export interface FindOptions {
  exists?: (path: string) => boolean;
  home?: string;
}

/**
 * Finds the `claude` executable: on the PATH (`where` on Windows, `which` elsewhere), else in the folder the official
 * installer uses. Null when it is not installed.
 */
export async function findClaude(
  run: Run = defaultRun,
  platform = process.platform,
  options: FindOptions = {},
): Promise<string | null> {
  const result = await run(platform === "win32" ? "where" : "which", ["claude"]);
  if (result.code === 0) {
    const candidates = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    // On Windows `where` also lists extension-less files; prefer something runnable.
    const found = candidates.find((c) => /\.(exe|cmd|bat)$/i.test(c)) ?? candidates[0];
    if (found) return found;
  }
  const installed = claudeInstallPath(platform, options.home);
  return (options.exists ?? existsSync)(installed) ? installed : null;
}

/**
 * Checks that Claude Code is installed and logged in, using only its own commands: `claude --version` and
 * `claude auth status --json`. From the status, only `loggedIn` is read; account details are dropped at once and
 * never stored, logged or sent anywhere.
 */
export async function detectClaude(
  run: Run = defaultRun,
  platform = process.platform,
  options: FindOptions = {},
): Promise<Detection> {
  const executable = await findClaude(run, platform, options);
  if (!executable) {
    return {
      ok: false,
      reason: "missing",
      message: "Claude Code is not installed.",
      fix: `Install Claude Code (${INSTALL_URL}), then reload this page.`,
    };
  }
  const version = await run(executable, ["--version"]);
  if (version.code !== 0) {
    return {
      ok: false,
      reason: "error",
      message: "Claude Code is installed but did not start.",
      fix: "Run `claude --version` in a terminal to see what is wrong.",
    };
  }
  const status = await run(executable, ["auth", "status", "--json"]);
  if (!loggedIn(status.stdout)) {
    return {
      ok: false,
      reason: "logged-out",
      message: "Claude Code is not logged in.",
      fix: "Run `claude` in a terminal and log in, then reload this page.",
    };
  }
  return { ok: true, version: version.stdout.trim().split(/\s+/)[0] ?? "unknown", executable };
}

function loggedIn(statusJson: string): boolean {
  try {
    return (JSON.parse(statusJson) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return false;
  }
}
