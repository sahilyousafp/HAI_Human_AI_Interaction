import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run } from "@hai/agent-core";
import { beforeAll, describe, expect, it } from "vitest";
import { HELPER_DIR, sharedPythonEnv } from "../../test/python-env.ts";
import { isPackageSpec, PythonEnv, packageName } from "./python-env.ts";
import { capOutput, PythonWorkbench } from "./python-run.ts";

const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

describe("package names", () => {
  it.each(["numpy", "ladybug-core", "numpy==2.1.0", "shapely>=2", "pandas[performance]", "IfcOpenShell"])(
    "accepts %s",
    (spec) => expect(isPackageSpec(spec)).toBe(true),
  );

  it.each([
    "--index-url=https://evil.example",
    "-r requirements.txt",
    "https://evil.example/x.whl",
    "git+https://github.com/a/b",
    "../local/package",
    "numpy; import os",
    "a b",
    "",
    "x".repeat(101),
  ])("refuses %j: it could be an option, a URL or a path", (spec) => {
    expect(isPackageSpec(spec)).toBe(false);
  });

  it("compares names as pip does", () => {
    expect(packageName("Ladybug_Core==1.0")).toBe("ladybug-core");
    expect(packageName("pandas[performance]>=2")).toBe("pandas");
  });
});

describe("the managed environment without a real Python", () => {
  const noPython: Run = async () => ({
    code: null,
    stdout: "",
    stderr: "",
    error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
  });

  it("no Python on the machine: the run says how to get one", async () => {
    const project = temp("hai-py-none-");
    const env = new PythonEnv({ projectDir: () => project, run: noPython });
    const result = await env.ensure([]);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toMatch(/No Python was found.*python\.org/);
    expect(env.status()).toEqual({ state: "missing" });
  });

  it("a Python that is too old is named, with what to do", async () => {
    const old: Run = async () => ({ code: 0, stdout: "C:\\Python39\\python.exe\n3 9\n", stderr: "" });
    const env = new PythonEnv({ projectDir: () => temp("hai-py-old-"), run: old });
    const result = await env.findPython();
    expect(result.ok === false && result.error).toMatch(/Python 3\.9 was found.*3\.10 or newer/);
  });

  it("a failed install says what failed and leaves nothing recorded", async () => {
    const project = temp("hai-py-fail-");
    const calls: string[][] = [];
    const run: Run = async (command, args) => {
      calls.push([command, ...args]);
      if (args.includes("-c")) return { code: 0, stdout: "C:\\Python312\\python.exe\n3 12\n", stderr: "" };
      if (args.includes("venv")) {
        // Pretend the environment was made.
        const dir = args.at(-1) as string;
        const { mkdirSync } = await import("node:fs");
        mkdirSync(join(dir, process.platform === "win32" ? "Scripts" : "bin"), { recursive: true });
        writeFileSync(
          join(
            dir,
            process.platform === "win32" ? "Scripts" : "bin",
            process.platform === "win32" ? "python.exe" : "python",
          ),
          "",
        );
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "ERROR: No matching distribution found for nonexistent-pkg\n" };
    };
    const env = new PythonEnv({ projectDir: () => project, run, startingPackages: [] });
    const result = await env.ensure(["nonexistent-pkg"]);
    expect(result.ok === false && result.error).toMatch(
      /Installing nonexistent-pkg failed.*No matching distribution/s,
    );
    // An environment that did not finish installing is not ready, so the next run installs again.
    expect(env.status()).toEqual({ state: "missing" });
  });

  it("a venv path too long for Windows goes under the application data folder instead", () => {
    const longProject = join(tmpdir(), "p".repeat(220));
    const env = new PythonEnv({
      projectDir: () => longProject,
      fallbackRoot: join(tmpdir(), "hai-fallback"),
    });
    const place = env.location() as string;
    expect(place.startsWith(join(tmpdir(), "hai-fallback"))).toBe(true);
    expect(place.length).toBeLessThan(200);
    const short = new PythonEnv({ projectDir: () => join(tmpdir(), "proj") });
    expect(short.location()).toBe(join(tmpdir(), "proj", ".hai", "python"));
  });

  it("what a run would install is the starting packages on first use, then only what is new", () => {
    const env = new PythonEnv({ projectDir: () => temp("hai-py-would-") });
    expect(env.wouldInstall(["shapely"])).toEqual(["rhino3dm", "ladybug-core", "numpy", "shapely"]);
    expect(env.wouldInstall(["numpy==2.0", "numpy"])).toEqual(["rhino3dm", "ladybug-core", "numpy==2.0"]);
  });

  it("an open project is needed", async () => {
    const env = new PythonEnv({ projectDir: () => null });
    expect(await env.ensure([])).toEqual({ ok: false, error: "Open a project first." });
  });
});

describe("capOutput", () => {
  it("keeps the start and the end of long output", () => {
    const text = `${"a".repeat(15_000)}MIDDLE${"z".repeat(15_000)}`;
    const capped = capOutput(text);
    expect(capped.length).toBeLessThan(20_100);
    expect(capped.startsWith("aaa")).toBe(true);
    expect(capped.endsWith("zzz")).toBe(true);
    expect(capped).toContain("characters left out");
    expect(capped).not.toContain("MIDDLE");
    expect(capOutput("short")).toBe("short");
  });
});

describe("running scripts in a real environment", async () => {
  const env = await sharedPythonEnv().catch(() => null);
  const real = env !== null;
  let project = "";
  let bench: PythonWorkbench;

  beforeAll(() => {
    project = temp("hai-py-run-");
    if (env) bench = new PythonWorkbench({ env, projectDir: () => project, helperDir: HELPER_DIR });
  }, 300_000);

  const run = (code: string, extra: Partial<Parameters<PythonWorkbench["run"]>[0]> = {}) =>
    bench.run({ code, title: "Test run", packages: [], agent: "architect", ...extra });

  it.skipIf(!real)(
    "a script runs and answers: what it printed and the value of result",
    async () => {
      const out = await run("print('hello from python')\nresult = 6 * 7");
      expect(out).toMatchObject({ ok: true, result: "42" });
      expect(out.stdout).toContain("hello from python");
    },
    120_000,
  );

  it.skipIf(!real)(
    "works without Rhino: rhino3dm builds and writes a .3dm, and the run reports the file",
    async () => {
      const out = await run(
        [
          "import rhino3dm as r",
          "model = r.File3dm()",
          "model.Objects.AddBrep(r.Brep.CreateFromBox(r.Box(r.BoundingBox(r.Point3d(0,0,0), r.Point3d(2000,1000,3000)))))",
          "model.Write('box.3dm', 8)",
          "result = 'written'",
        ].join("\n"),
      );
      expect(out).toMatchObject({ ok: true, result: "written" });
      expect(out.written.map((w) => w.path)).toEqual(["box.3dm"]);
      expect(existsSync(join(project, "box.3dm"))).toBe(true);
      // A second run that does not touch the file reports nothing.
      expect((await run("result = 1")).written).toEqual([]);
    },
    120_000,
  );

  it.skipIf(!real)(
    "an error is returned, with its message and the end of the traceback, and does not throw",
    async () => {
      const out = await run("def f():\n    return 1 / 0\nf()");
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/ZeroDivisionError/);
      expect(out.error).toMatch(/in f/);
    },
    120_000,
  );

  it.skipIf(!real)(
    "a syntax error comes back as an error too",
    async () => {
      const out = await run("def broken(:\n  pass");
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/SyntaxError/);
    },
    120_000,
  );

  it.skipIf(!real)(
    "an exit code from the script is an error",
    async () => {
      const out = await run("import sys\nsys.exit(3)");
      expect(out).toMatchObject({ ok: false });
      expect(out.error).toMatch(/exited with code 3/);
    },
    120_000,
  );

  it.skipIf(!real)(
    "output is capped at 20 000 characters",
    async () => {
      const out = await run("print('x' * 60000)");
      expect(out.ok).toBe(true);
      expect(out.stdout.length).toBeLessThan(20_200);
      expect(out.stdout).toContain("characters left out");
    },
    120_000,
  );

  it.skipIf(!real)(
    "a run is kept as a script with a header that says how it went",
    async () => {
      const out = await run("print('kept')\nresult = 'done'", { title: "Keep me!" });
      expect(out.script).toMatch(/^\.hai\/scripts\/\d{8}-\d{6}-keep-me\.py$/);
      const kept = readFileSync(join(project, out.script), "utf8");
      expect(kept).toContain("# outcome: ok");
      expect(kept).toContain("# title: Keep me!");
      expect(kept).toContain("# result: done");
      expect(kept).toContain("#   kept");
      expect(kept).toContain("print('kept')");
      // The folder is git-ignored with the rest of .hai.
      expect(readFileSync(join(project, ".hai", ".gitignore"), "utf8")).toBe("*\n");
      // The kept file is itself a script that runs.
      const rerun = await run(readFileSync(join(project, out.script), "utf8"), { title: "Rerun" });
      expect(rerun).toMatchObject({ ok: true, result: "done" });
    },
    120_000,
  );

  it.skipIf(!real)(
    "a failed run is kept too, with its error",
    async () => {
      const out = await run("raise ValueError('nope')", { title: "Fails" });
      const kept = readFileSync(join(project, out.script), "utf8");
      expect(kept).toContain("# outcome: error");
      expect(kept).toContain("ValueError: nope");
    },
    120_000,
  );

  it.skipIf(!real)(
    "time limit: a script that runs too long is ended",
    async () => {
      const started = Date.now();
      const out = await run("import time\ntime.sleep(60)", { timeoutMs: 1500 });
      expect(out).toMatchObject({ ok: false, timedOut: true });
      expect(out.error).toMatch(/longer than 2 seconds/);
      expect(Date.now() - started).toBeLessThan(8000);
    },
    120_000,
  );

  it.skipIf(!real)(
    "stop: pressing Stop ends the run within 3 seconds",
    async () => {
      const controller = new AbortController();
      const running = run("import time\ntime.sleep(60)", { signal: controller.signal, timeoutMs: 120_000 });
      await new Promise((r) => setTimeout(r, 1500));
      const stoppedAt = Date.now();
      controller.abort();
      const out = await running;
      expect(out).toMatchObject({ ok: false, stopped: true });
      expect(Date.now() - stoppedAt).toBeLessThan(3000);
    },
    120_000,
  );

  it.skipIf(!real)(
    "an option disguised as a package is refused before anything is installed",
    async () => {
      const out = await run("result = 1", { packages: ["--index-url=https://evil.example"] });
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/not a package name/);
    },
    120_000,
  );

  it.skipIf(!real)(
    "the script's working folder is the project",
    async () => {
      const out = await run("import os\nresult = os.getcwd()");
      expect(out.result?.toLowerCase()).toBe(project.toLowerCase());
    },
    120_000,
  );

  it.skipIf(!real)(
    "hai_3dm is importable and ends cleanly: render meshes are stored, exit code is fine",
    async () => {
      const out = await run(
        [
          "import math, rhino3dm as r, hai_3dm",
          "model = r.File3dm()",
          "profile = r.NurbsCurve.CreateFromLine(r.Line(r.Point3d(800,0,0), r.Point3d(300,0,2200)))",
          "rev = r.RevSurface.Create(profile, r.Line(r.Point3d(0,0,0), r.Point3d(0,0,1)), 0.0, 2*math.pi)",
          "hai_3dm.add(model, r.Brep.CreateFromRevSurface(rev, True, True), 'Vase', 'Roof', (60,110,200))",
          "hai_3dm.save(model, 'vase.3dm')",
        ].join("\n"),
      );
      expect(out.ok).toBe(true);
      expect(out.stdout).toContain("render meshes added: 3");
      expect(out.written.map((w) => w.path)).toContain("vase.3dm");
    },
    120_000,
  );
});
