import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run as defaultRun, type Run } from "@hai/agent-core";

/** What a managed environment starts with: `rhino3dm` writes `.3dm` files, `ladybug-core` studies climate. */
export const STARTING_PACKAGES = ["rhino3dm", "ladybug-core", "numpy"] as const;

/** The oldest Python the environment is made from. */
export const MIN_PYTHON = [3, 10] as const;

/** A venv path longer than this goes under the user's application data: Windows stops at 260 characters. */
export const MAX_ENV_PATH = 200;

/** How long installing packages may take. */
const INSTALL_TIMEOUT_MS = 10 * 60_000;

/**
 * A package as pip is given it: a name and, if wished, one version rule (`ladybug-core`, `numpy==2.1.0`,
 * `shapely>=2`). Nothing that starts with `-` (an option such as `--index-url`), no URLs, paths or spaces: the
 * packages come from an agent, and the user approves exactly what is listed.
 */
const PACKAGE =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?((==|>=|<=|~=|!=|>|<)[A-Za-z0-9.*+!_-]+)?$/;

export const isPackageSpec = (spec: string): boolean => spec.length <= 100 && PACKAGE.test(spec);

/** The name part of a package spec, as pip compares names (lower case, runs of `-_.` equal). */
export function packageName(spec: string): string {
  const name = /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(spec)?.[0] ?? spec;
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

export type PythonEnvStatus =
  | { state: "missing" }
  | { state: "ready"; python: string; packages: string[] }
  | { state: "unavailable"; reason: string };

export interface PythonEnvOptions {
  /** The open project folder, or null. */
  projectDir(): string | null;
  /** A fixed folder for the environment, whatever the project (tests share one); the project's own otherwise. */
  location?: string;
  /** Where to put an environment whose path would be too long (the user's application data). */
  fallbackRoot?: string;
  run?: Run;
  startingPackages?: readonly string[];
}

/** The environment's own record of what it installed, so the next run knows without asking pip. */
interface Record_ {
  packages: string[];
}

/**
 * The Python the agent's scripts run in: a virtual environment HAI makes in the project (`.hai/python`) from a Python
 * 3.10 or newer it finds on the machine, never the user's own installation. The first use creates it with the starting
 * packages; later runs add what a script asks for, after the user has approved the list. Packages are installed from
 * PyPI on the user's machine and never shipped with HAI.
 */
export class PythonEnv {
  private installing: Promise<unknown> = Promise.resolve();
  private readonly run: Run;

  constructor(private readonly options: PythonEnvOptions) {
    this.run = options.run ?? defaultRun;
  }

  get starting(): readonly string[] {
    return this.options.startingPackages ?? STARTING_PACKAGES;
  }

  /** The environment's folder: under the project, or under the user's application data when that path is too long. */
  location(): string | null {
    if (this.options.location) return this.options.location;
    const project = this.options.projectDir();
    if (!project) return null;
    const inProject = join(project, ".hai", "python");
    if (inProject.length <= MAX_ENV_PATH) return inProject;
    const root =
      this.options.fallbackRoot ??
      join(process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"), "HAI", "python");
    return join(root, createHash("sha1").update(project).digest("hex").slice(0, 12));
  }

  /** The interpreter inside the environment. */
  private interpreter(dir: string): string {
    return process.platform === "win32" ? join(dir, "Scripts", "python.exe") : join(dir, "bin", "python");
  }

  private recordFile(dir: string): string {
    return join(dir, "hai-packages.json");
  }

  /** What the environment recorded installing, or null if it never finished its first install. */
  private installed(dir: string): string[] | null {
    try {
      const data = JSON.parse(readFileSync(this.recordFile(dir), "utf8")) as Record_;
      return Array.isArray(data.packages) ? data.packages : null;
    } catch {
      return null;
    }
  }

  /** Whether the environment can run scripts: it exists and finished installing its starting packages. */
  status(): PythonEnvStatus {
    const dir = this.location();
    if (!dir) return { state: "unavailable", reason: "Open a project first." };
    const python = this.interpreter(dir);
    const packages = existsSync(python) ? this.installed(dir) : null;
    return packages ? { state: "ready", python, packages } : { state: "missing" };
  }

  /** The packages a run needing `wanted` would install: all the starting ones until the environment is ready. */
  wouldInstall(wanted: readonly string[]): string[] {
    const status = this.status();
    const have = new Set(status.state === "ready" ? status.packages.map(packageName) : []);
    const specs = new Map<string, string>(); // a spec with a version rule beats one without
    for (const spec of status.state === "ready" ? wanted : [...this.starting, ...wanted]) {
      const name = packageName(spec);
      if (!specs.has(name) || /[=<>!~]/.test(spec)) specs.set(name, spec);
    }
    return [...specs].filter(([name]) => !have.has(name)).map(([, spec]) => spec);
  }

  /** A Python 3.10+ on the machine: the `py` launcher first, then `python`, then `python3`. */
  async findPython(): Promise<{ ok: true; exe: string } | { ok: false; error: string }> {
    const candidates: Array<[string, string[]]> =
      process.platform === "win32"
        ? [
            ["py", ["-3"]],
            ["python", []],
            ["python3", []],
          ]
        : [
            ["python3", []],
            ["python", []],
          ];
    const probe = "import sys; print(sys.executable); print(sys.version_info[0], sys.version_info[1])";
    let found: string | null = null;
    for (const [command, prefix] of candidates) {
      const result = await this.run(command, [...prefix, "-c", probe], { timeoutMs: 20_000 });
      if (result.error || result.code !== 0) continue;
      const [exe, version] = result.stdout.trim().split(/\r?\n/);
      const [major = 0, minor = 0] = (version ?? "").split(" ").map(Number);
      if (exe && (major > MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor >= MIN_PYTHON[1])))
        return { ok: true, exe };
      found = `${major}.${minor}`;
    }
    return {
      ok: false,
      error: found
        ? `Python ${found} was found, but HAI needs Python ${MIN_PYTHON.join(".")} or newer. Install a newer Python from python.org and try again.`
        : `No Python was found on this machine. Install Python ${MIN_PYTHON.join(".")} or newer from python.org (tick "Add python.exe to PATH") and try again.`,
    };
  }

  /**
   * Makes sure the environment exists and has these packages, creating it and installing as needed. Installs run one
   * at a time. Returns the interpreter, or why it could not.
   */
  ensure(wanted: readonly string[]): Promise<{ ok: true; python: string } | { ok: false; error: string }> {
    const job = this.installing.then(() => this.ensureNow(wanted));
    this.installing = job.catch(() => undefined);
    return job;
  }

  private async ensureNow(wanted: readonly string[]) {
    for (const spec of wanted) {
      if (!isPackageSpec(spec))
        return { ok: false as const, error: `"${spec}" is not a package name pip can install.` };
    }
    const dir = this.location();
    if (!dir) return { ok: false as const, error: "Open a project first." };
    const python = this.interpreter(dir);
    const toInstall = this.wouldInstall(wanted);
    if (!existsSync(python)) {
      const base = await this.findPython();
      if (!base.ok) return { ok: false as const, error: base.error };
      mkdirSync(join(dir, ".."), { recursive: true });
      const made = await this.run(base.exe, ["-m", "venv", dir], { timeoutMs: 120_000 });
      if (made.error || made.code !== 0) {
        return {
          ok: false as const,
          error: `The Python environment could not be created: ${tail(made.stderr || made.error?.message || "")}`,
        };
      }
    }
    if (toInstall.length > 0) {
      const result = await this.run(
        python,
        ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", ...toInstall],
        { timeoutMs: INSTALL_TIMEOUT_MS },
      );
      if (result.error || result.code !== 0) {
        return {
          ok: false as const,
          error: `Installing ${toInstall.join(", ")} failed: ${tail(result.stderr || result.error?.message || result.stdout)}`,
        };
      }
      const before = this.installed(dir) ?? [];
      const known = new Set(before.map(packageName));
      const merged = [...before, ...toInstall.filter((spec) => !known.has(packageName(spec)))];
      writeFileSync(this.recordFile(dir), `${JSON.stringify({ packages: merged }, null, 2)}\n`);
    }
    if (this.installed(dir) === null)
      writeFileSync(
        this.recordFile(dir),
        `${JSON.stringify({ packages: [] }, null, 2)}
`,
      );
    return { ok: true as const, python };
  }
}

/** The end of a message: pip's last lines say what went wrong. */
function tail(text: string, lines = 6): string {
  return text.trim().split(/\r?\n/).slice(-lines).join("\n");
}
