import { spawn } from "node:child_process";
import { CLAUDE_INSTALL_COMMAND } from "./claude-install.ts";

/** How an install ended: the exit code, or why it could not even start. */
export interface InstallResult {
  code: number | null;
  /** Set when the program could not be started at all (PowerShell is missing). */
  startError?: string;
}

/** Runs the installer, calling `onLine` with each line of its output as it arrives. */
export type InstallRunner = (onLine: (line: string) => void) => Promise<InstallResult>;

/**
 * Runs a program to the end without a console window, handing each line of its output (standard output and error) to
 * `onLine`. Used for the installer; also by tests, with a stand-in program.
 */
export function createProcessRunner(file: string, args: readonly string[]): InstallRunner {
  return (onLine) =>
    new Promise((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(file, [...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        resolve({ code: null, startError: (error as Error).message });
        return;
      }
      let settled = false;
      const finish = (result: InstallResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      for (const stream of [child.stdout, child.stderr]) {
        let pending = "";
        stream?.setEncoding("utf8");
        stream?.on("data", (chunk: string) => {
          const lines = (pending + chunk).split(/\r?\n|\r/);
          pending = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) onLine(line.trim());
        });
        stream?.on("end", () => {
          if (pending.trim()) onLine(pending.trim());
        });
      }
      child.on("error", (error) => finish({ code: null, startError: error.message }));
      child.on("close", (code) => finish({ code }));
    });
}

/** What PowerShell is given: the command the screen shows, word for word, as its last argument. */
export const CLAUDE_INSTALL_ARGS = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  CLAUDE_INSTALL_COMMAND,
] as const;

/**
 * Anthropic's own installer for Windows: the command the screen shows, run in PowerShell for the current user. It
 * needs no administrator rights and adds nothing that is not Claude Code's.
 */
export const claudeInstallRunner: InstallRunner = createProcessRunner("powershell.exe", CLAUDE_INSTALL_ARGS);
