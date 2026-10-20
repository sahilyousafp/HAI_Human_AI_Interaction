import type { Detection } from "../provider.ts";
import { run as defaultRun, type Run } from "./run.ts";

export const INSTALL_URL = "https://docs.anthropic.com/en/docs/claude-code/setup";

/** Finds the `claude` executable on PATH: `where` on Windows, `which` elsewhere. Null when it is not installed. */
export async function findClaude(run: Run = defaultRun, platform = process.platform): Promise<string | null> {
  const result = await run(platform === "win32" ? "where" : "which", ["claude"]);
  if (result.code !== 0) return null;
  const candidates = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  // On Windows `where` also lists extension-less files; prefer something runnable.
  return candidates.find((c) => /\.(exe|cmd|bat)$/i.test(c)) ?? candidates[0] ?? null;
}

/**
 * Checks that Claude Code is installed and logged in, using only its own commands: `claude --version` and
 * `claude auth status --json`. From the status, only `loggedIn` is read; account details are dropped at once and
 * never stored, logged or sent anywhere.
 */
export async function detectClaude(run: Run = defaultRun, platform = process.platform): Promise<Detection> {
  const executable = await findClaude(run, platform);
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
