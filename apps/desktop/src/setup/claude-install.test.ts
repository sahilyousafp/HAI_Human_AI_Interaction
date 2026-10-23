import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Detection } from "@hai/agent-core";
import type { ClaudeInstallInfo, ClaudeSetup } from "@hai/protocol";
import { describe, expect, it, vi } from "vitest";
import { createClaudeSetup } from "./claude.ts";
import {
  CLAUDE_INSTALL_COMMAND,
  CLAUDE_INSTALL_SOURCE,
  CLAUDE_INSTRUCTIONS_URL,
  CLAUDE_PREREQUISITES,
} from "./claude-install.ts";
import { CLAUDE_INSTALL_ARGS, createProcessRunner, type InstallRunner } from "./install-runner.ts";

const INFO: ClaudeInstallInfo = {
  command: CLAUDE_INSTALL_COMMAND,
  source: CLAUDE_INSTALL_SOURCE,
  instructionsUrl: CLAUDE_INSTRUCTIONS_URL,
};
const READY: Detection = { ok: true, version: "2.1.303", executable: "x" };
const MISSING: Detection = { ok: false, reason: "missing", message: "m", fix: "f" };

const folder = mkdtempSync(join(tmpdir(), "hai-installer-"));
/** A stand-in installer: a Node script that prints these lines to standard output and exits with this code. */
function standIn(name: string, body: string): InstallRunner {
  const file = join(folder, `${name}.mjs`);
  writeFileSync(file, body);
  return createProcessRunner(process.execPath, [file]);
}

/** Records the status of every state the holder reports. */
function watch(setup: ReturnType<typeof createClaudeSetup>) {
  const seen: ClaudeSetup["state"][] = [];
  setup.onChange((s) => seen.push(s.state));
  return seen;
}

describe("what the screen shows and runs", () => {
  it("the command shown is the command run, word for word, from Anthropic's own address", () => {
    expect(CLAUDE_INSTALL_ARGS.at(-1)).toBe(CLAUDE_INSTALL_COMMAND);
    expect(CLAUDE_INSTALL_COMMAND).toBe(`irm ${CLAUDE_INSTALL_SOURCE} | iex`);
    expect(CLAUDE_INSTALL_SOURCE).toBe("https://claude.ai/install.ps1");
    expect(CLAUDE_INSTRUCTIONS_URL).toMatch(/^https:\/\/code\.claude\.com\//);
  });

  it("needs no prerequisite today (Git for Windows is optional)", () => {
    expect(CLAUDE_PREREQUISITES).toEqual([]);
  });
});

describe("nothing runs before the button", () => {
  it("looking, listening and refocusing never start the installer", async () => {
    const runInstaller = vi.fn<InstallRunner>(async () => ({ code: 0 }));
    const setup = createClaudeSetup({ detect: async () => MISSING, info: INFO, runInstaller });
    setup.onChange(() => {});
    setup.snapshot();
    await setup.recheck();
    await setup.recheckOnFocus();
    expect(runInstaller).not.toHaveBeenCalled();
    expect(setup.snapshot().state.status).toBe("missing");
  });

  it("starts it when asked to, once", async () => {
    const runInstaller = vi.fn<InstallRunner>(async () => ({ code: 0 }));
    const setup = createClaudeSetup({ detect: async () => MISSING, info: INFO, runInstaller });
    await setup.recheck();
    await setup.install();
    expect(runInstaller).toHaveBeenCalledOnce();
  });

  it("is not available without an installer to run", async () => {
    const setup = createClaudeSetup({ detect: async () => MISSING, info: INFO });
    await expect(setup.install()).rejects.toThrow(/not available/);
  });
});

describe("install", () => {
  it("shows the installer's output as it arrives, then looks again and moves on", async () => {
    let installed = false;
    const real = standIn(
      "ok",
      'console.log("Downloading Claude Code..."); console.log("Installed to C:\\\\Users\\\\me\\\\.local\\\\bin");',
    );
    const setup = createClaudeSetup({
      detect: async () => (installed ? READY : MISSING),
      info: INFO,
      outputIntervalMs: 0,
      runInstaller: async (onLine) => {
        const result = await real(onLine);
        installed = true;
        return result;
      },
    });
    const seen = watch(setup);
    await setup.recheck();
    await setup.install();

    const statuses = seen.map((s) => s.status);
    expect(statuses[0]).toBe("missing");
    expect(statuses).toContain("installing");
    expect(statuses.at(-1)).toBe("ready");
    const lastInstalling = seen.filter((s) => s.status === "installing").at(-1);
    expect(lastInstalling).toEqual({
      status: "installing",
      output: ["Downloading Claude Code...", "Installed to C:\\Users\\me\\.local\\bin"],
    });
    expect(setup.snapshot().state).toEqual({ status: "ready", version: "2.1.303" });
  });

  it("goes on to the sign-in step when it installed but nobody is signed in", async () => {
    let installed = false;
    const setup = createClaudeSetup({
      detect: async () => (installed ? { ok: false, reason: "logged-out", message: "m", fix: "f" } : MISSING),
      info: INFO,
      runInstaller: async () => {
        installed = true;
        return { code: 0 };
      },
    });
    await setup.recheck();
    await setup.install();
    expect(setup.snapshot().state).toEqual({ status: "signed-out" });
  });

  it("fails with the installer's own words when it exits with an error", async () => {
    const setup = createClaudeSetup({
      detect: async () => MISSING,
      info: INFO,
      outputIntervalMs: 0,
      runInstaller: standIn(
        "fail",
        'console.log("Checking your system..."); console.error("Access to the path is denied"); process.exit(2);',
      ),
    });
    await setup.recheck();
    await setup.install();
    const state = setup.snapshot().state;
    expect(state).toMatchObject({
      status: "install-failed",
      message: "The installer stopped with an error (exit code 2).",
    });
    if (state.status === "install-failed") {
      expect(state.output).toContain("Checking your system...");
      expect(state.output).toContain("Access to the path is denied");
    }
  });

  it("fails and keeps the output when the installer's address cannot be reached", async () => {
    const setup = createClaudeSetup({
      detect: async () => MISSING,
      info: INFO,
      runInstaller: standIn(
        "offline",
        'console.error("irm : Unable to connect to the remote server"); process.exit(1);',
      ),
    });
    await setup.recheck();
    await setup.install();
    const state = setup.snapshot().state;
    expect(state.status).toBe("install-failed");
    if (state.status === "install-failed")
      expect(state.output.join("\n")).toContain("Unable to connect to the remote server");
  });

  it("fails when the installer cannot be started at all", async () => {
    const setup = createClaudeSetup({
      detect: async () => MISSING,
      info: INFO,
      runInstaller: createProcessRunner(join(folder, "no-such-program.exe"), []),
    });
    await setup.recheck();
    await setup.install();
    const state = setup.snapshot().state;
    expect(state).toMatchObject({ status: "install-failed" });
    if (state.status === "install-failed") expect(state.message).toContain("could not be started");
  });

  it("still looks the same after a failure, so the user can try again", async () => {
    let attempts = 0;
    const setup = createClaudeSetup({
      detect: async () => (attempts > 1 ? READY : MISSING),
      info: INFO,
      runInstaller: async () => ({ code: ++attempts === 1 ? 1 : 0 }),
    });
    await setup.recheck();
    await setup.install();
    expect(setup.snapshot().state.status).toBe("install-failed");
    await setup.install();
    expect(setup.snapshot().state.status).toBe("ready");
    expect(attempts).toBe(2);
  });

  it("joins an install that is already running", async () => {
    let runs = 0;
    const setup = createClaudeSetup({
      detect: async () => MISSING,
      info: INFO,
      runInstaller: async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 30));
        return { code: 0 };
      },
    });
    await setup.recheck();
    await Promise.all([setup.install(), setup.install()]);
    expect(runs).toBe(1);
  });

  it("does nothing when Claude Code is already ready", async () => {
    const runInstaller = vi.fn<InstallRunner>(async () => ({ code: 0 }));
    const setup = createClaudeSetup({ detect: async () => READY, info: INFO, runInstaller });
    await setup.recheck();
    await setup.install();
    expect(runInstaller).not.toHaveBeenCalled();
  });

  it("leaves the screen alone while it runs: a check meanwhile answers with the install", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const detect = vi.fn(async () => MISSING);
    const setup = createClaudeSetup({
      detect,
      info: INFO,
      runInstaller: async () => {
        await gate;
        return { code: 0 };
      },
    });
    await setup.recheck();
    const running = setup.install();
    await vi.waitFor(() => expect(setup.snapshot().state.status).toBe("installing"));
    const checksBefore = detect.mock.calls.length;
    expect((await setup.recheck()).state.status).toBe("installing");
    await setup.recheckOnFocus();
    expect(detect.mock.calls.length).toBe(checksBefore);
    release();
    await running;
  });

  it("keeps at most the last 200 lines of output", async () => {
    const setup = createClaudeSetup({
      detect: async () => MISSING,
      info: INFO,
      outputIntervalMs: 0,
      runInstaller: async (onLine) => {
        for (let i = 1; i <= 250; i++) onLine(`line ${i}`);
        return { code: 1 };
      },
    });
    await setup.recheck();
    await setup.install();
    const state = setup.snapshot().state;
    if (state.status !== "install-failed") throw new Error("expected a failure");
    expect(state.output).toHaveLength(200);
    expect(state.output[0]).toBe("line 51");
    expect(state.output.at(-1)).toBe("line 250");
  });
});

describe("createProcessRunner", () => {
  it("passes on each line, including a last one with no line break, and the error stream", async () => {
    const lines: string[] = [];
    const run = standIn(
      "lines",
      'process.stdout.write("one\\ntwo\\r\\nthree"); process.stderr.write("oops\\n");',
    );
    const result = await run((l) => lines.push(l));
    expect(result).toEqual({ code: 0 });
    expect(lines.sort()).toEqual(["one", "oops", "three", "two"]);
  });

  it("treats a carriage return as a line end, so a progress display does not become one long line", async () => {
    const lines: string[] = [];
    const run = standIn("progress", 'process.stdout.write("10%\\r50%\\r100%\\n");');
    await run((l) => lines.push(l));
    expect(lines).toEqual(["10%", "50%", "100%"]);
  });

  it("reports the exit code", async () => {
    expect(await standIn("exit3", "process.exit(3);")(() => {})).toEqual({ code: 3 });
  });
});
