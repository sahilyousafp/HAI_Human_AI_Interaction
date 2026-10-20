import spawn from "cross-spawn";

export interface RunResult {
  /** Exit code, or null if the program could not be started or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the program could not be started at all (for example ENOENT). */
  error?: NodeJS.ErrnoException;
}

/** Runs a program to completion and collects its output. Injected in tests. */
export type Run = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => Promise<RunResult>;

/**
 * Runs a program without a shell. cross-spawn resolves Windows `.cmd` shims (an npm-installed `claude`) without
 * the quoting bugs of `shell: true`.
 */
export const run: Run = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, stdout, stderr: `${stderr}\nTimed out` });
    }, options.timeoutMs ?? 30_000);
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (error) => finish({ code: null, stdout, stderr, error }));
    child.on("close", (code) => finish({ code, stdout, stderr }));
  });
