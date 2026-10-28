import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { HELPER_DIR, sharedPythonEnv } from "../../test/python-env.ts";
import { KERNEL_PACKAGES } from "./kernel.ts";

/** Installing OpenCascade (a few hundred MB) the first time. */
const INSTALL_TIMEOUT_MS = 15 * 60_000;

describe("hai_occ, the OpenCascade recipes (python/test_hai_occ.py)", () => {
  let python: string | null = null;
  let unavailable = "no Python 3.10 or newer is installed";

  beforeAll(async () => {
    const env = await sharedPythonEnv();
    if (!env) return;
    const ready = await env.ensure(KERNEL_PACKAGES);
    if (!ready.ok) {
      unavailable = ready.error;
      return;
    }
    // Some machines refuse to load OpenCascade's native library (Windows Smart App Control): nothing can be tested there.
    const probe = spawnSync(ready.python, ["-c", "import OCP"], { encoding: "utf8" });
    if (probe.status !== 0) {
      unavailable = `OpenCascade cannot be loaded here: ${probe.stderr.trim().split(/\r?\n/).at(-1)}`;
      return;
    }
    python = ready.python;
  }, INSTALL_TIMEOUT_MS);

  it("passes its own tests: boolean, loft, sweep and offset against known volumes and outlines", (context) => {
    if (!python) context.skip(unavailable);
    const run = spawnSync(python as string, ["-m", "unittest", "test_hai_occ", "-v"], {
      cwd: HELPER_DIR,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    expect(run.stderr, run.stdout).toMatch(/\nOK\s*$/);
    expect(run.status).toBe(0);
  });
});
