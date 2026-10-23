import { join } from "node:path";
import { type Detection, detectClaude, type Run, run as realRun } from "@hai/agent-core";
import type { ClaudeInstallInfo, ClaudeSetup } from "@hai/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeSetup, stateFromDetection } from "./claude.ts";

const FAKE = join(import.meta.dirname, "..", "..", "..", "bridge", "test", "fake-claude.mjs");
const INFO: ClaudeInstallInfo = {
  command: "irm https://claude.ai/install.ps1 | iex",
  source: "https://claude.ai/install.ps1",
  instructionsUrl: "https://code.claude.com/docs/en/setup",
};

/**
 * The shared detection, running the fake Claude Code CLI (apps/bridge/test/fake-claude.mjs) as the `claude` it finds,
 * so the states come from the real checks and not from a stand-in for them.
 */
const fakeRun: Run = (command, args, options) =>
  command === "where" || command === "which"
    ? Promise.resolve({ code: 0, stdout: `${FAKE}\n`, stderr: "" })
    : realRun(process.execPath, [FAKE, ...args], options);
const detectFake = () => detectClaude(fakeRun, "linux", { exists: () => false, home: "/nowhere" });
const detectNone = () =>
  detectClaude(() => Promise.resolve({ code: 1, stdout: "", stderr: "" }), "linux", {
    exists: () => false,
    home: "/nowhere",
  });

const ENV = ["FAKE_CLAUDE_VERSION_FAILS", "FAKE_CLAUDE_LOGGED_IN"];
afterEach(() => {
  for (const name of ENV) delete process.env[name];
});

describe("the four states, from the shared checks and the fake CLI", () => {
  it("ready: installed and signed in, with its version", async () => {
    const setup = createClaudeSetup({ detect: detectFake, info: INFO });
    expect((await setup.recheck()).state).toEqual({ status: "ready", version: "2.1.303" });
  });

  it("missing: no claude to be found", async () => {
    const setup = createClaudeSetup({ detect: detectNone, info: INFO });
    expect((await setup.recheck()).state).toEqual({ status: "missing" });
  });

  it("broken: installed but it did not start", async () => {
    process.env.FAKE_CLAUDE_VERSION_FAILS = "1";
    const setup = createClaudeSetup({ detect: detectFake, info: INFO });
    expect((await setup.recheck()).state).toEqual({ status: "broken" });
  });

  it("signed out: installed and running, with no account signed in", async () => {
    process.env.FAKE_CLAUDE_LOGGED_IN = "0";
    const setup = createClaudeSetup({ detect: detectFake, info: INFO });
    expect((await setup.recheck()).state).toEqual({ status: "signed-out" });
  });

  it("an account's details never reach the state", async () => {
    const setup = createClaudeSetup({ detect: detectFake, info: INFO });
    expect(JSON.stringify(await setup.recheck())).not.toMatch(/email|token|account/i);
  });
});

describe("stateFromDetection", () => {
  it.each<[Detection, string]>([
    [{ ok: true, version: "1.0.0", executable: "x" }, "ready"],
    [{ ok: false, reason: "missing", message: "m", fix: "f" }, "missing"],
    [{ ok: false, reason: "error", message: "m", fix: "f" }, "broken"],
    [{ ok: false, reason: "logged-out", message: "m", fix: "f" }, "signed-out"],
  ])("%j is %s", (detection, status) => {
    expect(stateFromDetection(detection).status).toBe(status);
  });
});

describe("createClaudeSetup", () => {
  const ready: Detection = { ok: true, version: "2.1.303", executable: "x" };

  it("starts as checking, with the install facts the screen shows", () => {
    const setup = createClaudeSetup({ detect: async () => ready, info: INFO });
    expect(setup.snapshot()).toEqual({ state: { status: "checking" }, prerequisites: [], info: INFO });
  });

  it("tells listeners about each change", async () => {
    const setup = createClaudeSetup({ detect: async () => ready, info: INFO });
    const seen: ClaudeSetup[] = [];
    const stop = setup.onChange((s) => seen.push(s));
    await setup.recheck();
    expect(seen.map((s) => s.state.status)).toEqual(["ready"]);
    stop();
    await setup.recheck();
    expect(seen).toHaveLength(1);
  });

  it("joins a check that is already running instead of starting a second one", async () => {
    let runs = 0;
    const setup = createClaudeSetup({
      detect: async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 20));
        return ready;
      },
      info: INFO,
    });
    await Promise.all([setup.recheck(), setup.recheck(), setup.recheck()]);
    expect(runs).toBe(1);
  });

  it("follows a change: not installed, then installed and signed in", async () => {
    let installed = false;
    const setup = createClaudeSetup({
      detect: async () => (installed ? ready : { ok: false, reason: "missing", message: "m", fix: "f" }),
      info: INFO,
    });
    expect((await setup.recheck()).state.status).toBe("missing");
    installed = true;
    expect((await setup.recheck()).state.status).toBe("ready");
  });

  describe("when the window regains focus", () => {
    it("checks again, but not twice within the cooldown", async () => {
      let clock = 0;
      let runs = 0;
      const setup = createClaudeSetup({
        detect: async () => {
          runs++;
          return ready;
        },
        info: INFO,
        now: () => clock,
        focusCooldownMs: 2000,
      });
      await setup.recheckOnFocus();
      await setup.recheckOnFocus(); // straight away: skipped
      expect(runs).toBe(1);
      clock += 2500;
      await setup.recheckOnFocus();
      expect(runs).toBe(2);
    });

    it("always checks when asked to, whatever the cooldown", async () => {
      let runs = 0;
      const setup = createClaudeSetup({
        detect: async () => {
          runs++;
          return ready;
        },
        info: INFO,
        now: () => 0,
      });
      await setup.recheck();
      await setup.recheck();
      expect(runs).toBe(2);
    });
  });

  describe("prerequisites", () => {
    it("lists each with whether this computer has it, none required today", async () => {
      const setup = createClaudeSetup({
        detect: async () => ready,
        info: INFO,
        prerequisites: [
          { id: "git", label: "Git for Windows", why: "x", check: async () => true },
          { id: "other", label: "Other", why: "y", check: async () => false },
          { id: "boom", label: "Boom", why: "z", check: async () => Promise.reject(new Error("no")) },
        ],
      });
      const result = await setup.recheck();
      expect(result.prerequisites.map((p) => [p.id, p.ok])).toEqual([
        ["git", true],
        ["other", false],
        ["boom", false],
      ]);
    });
  });
});
