import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PythonEnv } from "../src/python/python-env.ts";

/** Where the helper files that ship with the bridge live. */
export const HELPER_DIR = join(import.meta.dirname, "..", "python");

let shared: Promise<PythonEnv | null> | null = null;

/**
 * One real managed environment (rhino3dm and numpy) kept in the temp folder between runs, so the tests that need a real
 * Python install it once. Null where no Python 3.10 or newer is installed: those tests skip.
 */
export function sharedPythonEnv(): Promise<PythonEnv | null> {
  shared ??= (async () => {
    const location = join(tmpdir(), "hai-test-py", "env");
    mkdirSync(join(location, ".."), { recursive: true });
    const env = new PythonEnv({
      projectDir: () => join(tmpdir(), "hai-test-py"),
      location,
      startingPackages: ["rhino3dm", "numpy"],
    });
    if ((await env.findPython()).ok === false) return null;
    const ready = await env.ensure([]);
    return ready.ok ? env : null;
  })();
  return shared;
}
