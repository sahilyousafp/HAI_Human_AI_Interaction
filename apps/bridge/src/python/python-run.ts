import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isPackageSpec, type PythonEnv } from "./python-env.ts";

/** Output past this many characters is cut in the middle. */
export const OUTPUT_LIMIT = 20_000;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 600_000;
/** A stopped run ends within this long, even if the process is slow to die. */
const STOP_GRACE_MS = 2000;

export interface PythonRunInput {
  code: string;
  /** A short title: it names the kept script. */
  title: string;
  /** Packages to install first (the user has approved this list). */
  packages: string[];
  timeoutMs?: number;
  /** The team agent that asked, for the script's header. */
  agent: string | null;
  /** Aborted when the user presses Stop. */
  signal?: AbortSignal;
}

/** A `.3dm` file a run left in the project folder: new, or changed since before the run. */
export interface WrittenFile {
  /** Relative to the project folder, with forward slashes. */
  path: string;
  size: number;
}

export interface PythonRunOutput {
  ok: boolean;
  stdout: string;
  result?: string;
  error?: string;
  durationMs: number;
  /** The kept script, relative to the project folder. */
  script: string;
  written: WrittenFile[];
  stopped?: boolean;
  timedOut?: boolean;
}

export interface PythonWorkbenchOptions {
  env: PythonEnv;
  projectDir(): string | null;
  /** The folder holding `hai_run.py` and `hai_3dm.py`. */
  helperDir: string;
  now?: () => Date;
}

/** The comment block that starts a kept script: who ran it, what it asked for and how it ended. */
export function keptHeader(
  stamp: string,
  run: { title: string; packages: string[]; agent: string | null; where?: string },
  outcome: string,
  details: string[] = [],
): string {
  return [
    `# HAI run ${stamp}${run.agent ? ` by ${run.agent}` : ""}${run.where ? ` ${run.where}` : ""}`,
    `# title: ${run.title.replace(/\r?\n/g, " ")}`,
    `# packages: ${run.packages.join(", ") || "none"}`,
    `# outcome: ${outcome}`,
    ...details.flatMap((line) => line.split(/\r?\n/).map((l) => `# ${l}`)),
    "",
  ].join("\n");
}

/** Cuts text longer than the limit in the middle, keeping the start and the end. */
export function capOutput(text: string, limit = OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  const half = Math.floor(limit / 2);
  return `${text.slice(0, half)}\n[... ${text.length - limit} characters left out ...]\n${text.slice(-half)}`;
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "run";

/** The `.3dm` files under a folder (not in `.hai`, `.git`, `node_modules` or `assets`), with their change stamps. */
function snapshotThreeDm(root: string): Map<string, { mtime: number; size: number }> {
  const found = new Map<string, { mtime: number; size: number }>();
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || found.size > 2000) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if ([".hai", ".git", "node_modules", "assets"].includes(name)) continue;
      const full = join(dir, name);
      let info: ReturnType<typeof statSync>;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) walk(full, depth + 1);
      else if (name.toLowerCase().endsWith(".3dm"))
        found.set(relative(root, full).replace(/\\/g, "/"), { mtime: info.mtimeMs, size: info.size });
    }
  };
  walk(root, 0);
  return found;
}

/** Ends a process and what it started. */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

/**
 * Runs the agent's scripts in the managed environment. Each run is kept as a readable script in `.hai/scripts` with a
 * header that says what it asked for and how it ended, so the human can open, edit and rerun it. A run has a time
 * limit and can be stopped; its output is capped; and the `.3dm` files it leaves are reported.
 */
export class PythonWorkbench {
  constructor(private readonly options: PythonWorkbenchOptions) {}

  /**
   * Keeps a script that ran somewhere else (in Rhino) the same way as one that ran here, and returns its path relative
   * to the project. The header says where it ran.
   */
  record(
    input: { code: string; title: string; packages: string[]; agent: string | null },
    result: {
      ok: boolean;
      stdout: string;
      result?: string;
      error?: string;
      durationMs: number;
      stopped?: boolean;
      timedOut?: boolean;
    },
  ): string | null {
    const project = this.options.projectDir();
    if (!project) return null;
    const stamp = (this.options.now?.() ?? new Date()).toISOString();
    const dir = join(project, ".hai", "scripts");
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(project, ".hai", ".gitignore")))
      writeFileSync(join(project, ".hai", ".gitignore"), "*\n");
    const path = join(
      dir,
      `${stamp.replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}-${slug(input.title)}.py`,
    );
    const outcome = result.stopped ? "stopped" : result.timedOut ? "timed out" : result.ok ? "ok" : "error";
    writeFileSync(
      path,
      `${keptHeader(stamp, { ...input, where: "in Rhino" }, outcome, [
        `duration: ${result.durationMs} ms`,
        ...(result.result !== undefined ? [`result: ${result.result}`] : []),
        ...(result.error ? [`error: ${result.error}`] : []),
        ...(result.stdout ? ["output:", ...result.stdout.split(/\r?\n/).map((l) => `  ${l}`)] : []),
      ])}${input.code}\n`,
    );
    return relative(project, path).replace(/\\/g, "/");
  }

  scriptsDir(): string | null {
    const project = this.options.projectDir();
    return project ? join(project, ".hai", "scripts") : null;
  }

  async run(input: PythonRunInput): Promise<PythonRunOutput> {
    const project = this.options.projectDir();
    const started = Date.now();
    const fail = (error: string, extra: Partial<PythonRunOutput> = {}): PythonRunOutput => ({
      ok: false,
      stdout: "",
      error,
      durationMs: Date.now() - started,
      script: "",
      written: [],
      ...extra,
    });
    if (!project) return fail("Open a project first.");
    const bad = input.packages.find((spec) => !isPackageSpec(spec));
    if (bad) return fail(`"${bad}" is not a package name pip can install.`);

    const ensured = await this.options.env.ensure(input.packages);
    if (!ensured.ok) return fail(ensured.error);

    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
    const stamp = (this.options.now?.() ?? new Date()).toISOString();
    const dir = join(project, ".hai", "scripts");
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(project, ".hai", ".gitignore")))
      writeFileSync(join(project, ".hai", ".gitignore"), "*\n");
    const base = `${stamp.replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}-${slug(input.title)}`;
    const scriptPath = join(dir, `${base}.py`);
    const outcomePath = join(dir, `${base}.outcome.json`);
    const scriptRelative = relative(project, scriptPath).replace(/\\/g, "/");
    const header = (outcome: string, details: string[] = []) => keptHeader(stamp, input, outcome, details);
    writeFileSync(scriptPath, `${header("running")}${input.code}\n`);

    const before = snapshotThreeDm(project);
    const output = await this.execute(
      ensured.python,
      scriptPath,
      outcomePath,
      project,
      timeoutMs,
      input.signal,
    );
    rmSync(outcomePath, { force: true });

    const after = snapshotThreeDm(project);
    const written: WrittenFile[] = [...after]
      .filter(([path, info]) => {
        const old = before.get(path);
        return !old || old.mtime !== info.mtime || old.size !== info.size;
      })
      .map(([path, info]) => ({ path, size: info.size }));

    const outcome = output.stopped ? "stopped" : output.timedOut ? "timed out" : output.ok ? "ok" : "error";
    writeFileSync(
      scriptPath,
      `${header(outcome, [
        `duration: ${output.durationMs} ms`,
        ...(output.result !== undefined ? [`result: ${output.result}`] : []),
        ...(output.error ? [`error: ${output.error}`] : []),
        ...(output.stdout ? ["output:", ...output.stdout.split(/\r?\n/).map((l) => `  ${l}`)] : []),
      ])}${input.code}\n`,
    );
    return { ...output, script: scriptRelative, written };
  }

  private execute(
    python: string,
    script: string,
    outcomePath: string,
    cwd: string,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<Omit<PythonRunOutput, "script" | "written">> {
    const started = Date.now();
    return new Promise((resolvePromise) => {
      const env = { ...process.env };
      env.VIRTUAL_ENV = undefined;
      env.PYTHONHOME = undefined;
      const child = spawn(python, [join(this.options.helperDir, "hai_run.py"), script, outcomePath], {
        cwd,
        windowsHide: true,
        detached: process.platform !== "win32",
        env: {
          ...(Object.fromEntries(
            Object.entries(env).filter(([, v]) => v !== undefined),
          ) as NodeJS.ProcessEnv),
          PYTHONPATH: resolve(this.options.helperDir),
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
          PYTHONUNBUFFERED: "1",
          PYTHONDONTWRITEBYTECODE: "1",
        },
      });
      let stdout = "";
      let stderr = "";
      let stopped = false;
      let timedOut = false;
      let settled = false;
      // Output is kept to a bounded size while it streams, so a script that prints forever cannot fill memory.
      const keep = (current: string, chunk: Buffer) =>
        current.length > OUTPUT_LIMIT * 4 ? current : current + chunk.toString("utf8");
      child.stdout.on("data", (c: Buffer) => {
        stdout = keep(stdout, c);
      });
      child.stderr.on("data", (c: Buffer) => {
        stderr = keep(stderr, c);
      });

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        let outcome: { ok?: boolean; result?: string | null; error?: string | null } = {};
        try {
          outcome = JSON.parse(readFileSync(outcomePath, "utf8"));
        } catch {
          // The process ended before it wrote its outcome: killed, or crashed.
        }
        const raw = stderr
          ? `${stdout}${stdout && !stdout.endsWith("\n") ? "\n" : ""}[stderr]\n${stderr}`
          : stdout;
        // Windows ends printed lines with CR LF; the agent and the kept script read plain line feeds.
        const text = capOutput(raw.replace(/\r\n/g, "\n"));
        const durationMs = Date.now() - started;
        if (stopped)
          return resolvePromise({
            ok: false,
            stdout: text,
            error: "The run was stopped.",
            durationMs,
            stopped: true,
          });
        if (timedOut) {
          return resolvePromise({
            ok: false,
            stdout: text,
            error: `The script took longer than ${Math.round(timeoutMs / 1000)} seconds and was ended.`,
            durationMs,
            timedOut: true,
          });
        }
        const ok = outcome.ok === true;
        resolvePromise({
          ok,
          stdout: text,
          ...(outcome.result ? { result: capOutput(outcome.result) } : {}),
          ...(ok
            ? {}
            : {
                error: outcome.error ?? `The script ended without finishing (exit code ${child.exitCode}).`,
              }),
          durationMs,
        });
      };

      const end = (why: "stop" | "time") => {
        if (why === "stop") stopped = true;
        else timedOut = true;
        killTree(child.pid);
        // If the process is slow to die the run still ends in time.
        setTimeout(finish, STOP_GRACE_MS).unref?.();
      };
      const timer = setTimeout(() => end("time"), timeoutMs);
      const onAbort = () => end("stop");
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      child.on("error", (error) => {
        stderr += `${error.message}\n`;
        finish();
      });
      child.on("close", finish);
    });
  }
}
