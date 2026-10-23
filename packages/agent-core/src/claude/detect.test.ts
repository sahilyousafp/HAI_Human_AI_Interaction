import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeInstallFolder, claudeInstallPath, detectClaude, findClaude } from "./detect.ts";
import type { Run, RunResult } from "./run.ts";

/** A stand-in for the system: answers by command line, records what was run. */
function stub(answers: Record<string, Partial<RunResult>>) {
  const calls: string[] = [];
  const run: Run = async (command, args) => {
    const line = [command, ...args].join(" ");
    calls.push(line);
    const answer = answers[line];
    if (!answer)
      return {
        code: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      };
    return { code: 0, stdout: "", stderr: "", ...answer };
  };
  return { run, calls };
}

const EXE = "C:\\Users\\me\\.local\\bin\\claude.exe";
/** The machine has nothing in the installer's folder (a developer's own machine may, so tests never ask it). */
const NOTHING = { exists: () => false, home: "/home/test" };
/** The machine has the installer's executable, and nothing else. */
const HOME = join("/home", "test");
const installedAt = (platform: string) => ({
  exists: (path: string) => path === claudeInstallPath(platform, HOME),
  home: HOME,
});

describe("detectClaude", () => {
  it("CLI missing: says Claude Code is not installed and how to install it", async () => {
    const { run } = stub({ "where claude": { code: 1, stderr: "INFO: Could not find files" } });
    const result = await detectClaude(run, "win32", NOTHING);
    expect(result).toMatchObject({ ok: false, reason: "missing", message: "Claude Code is not installed." });
    expect(result.ok === false && result.fix).toContain("https://");
  });

  it("not logged in: tells the user to run claude in a terminal and log in", async () => {
    const { run } = stub({
      "where claude": { stdout: `${EXE}\r\n` },
      [`${EXE} --version`]: { stdout: "2.1.303 (Claude Code)\n" },
      [`${EXE} auth status --json`]: { code: 1, stdout: '{"loggedIn":false,"authMethod":"none"}' },
    });
    const result = await detectClaude(run, "win32", NOTHING);
    expect(result).toMatchObject({ ok: false, reason: "logged-out" });
    expect(result.ok === false && result.fix).toMatch(/run `claude` in a terminal and log in/i);
  });

  it("installed and logged in: reports the version and the executable, and nothing about the account", async () => {
    const { run, calls } = stub({
      "which claude": { stdout: "/usr/local/bin/claude\n" },
      "/usr/local/bin/claude --version": { stdout: "2.1.303 (Claude Code)\n" },
      "/usr/local/bin/claude auth status --json": {
        stdout: JSON.stringify({ loggedIn: true, email: "someone@example.com", orgName: "Studio" }),
      },
    });
    const result = await detectClaude(run, "linux", NOTHING);
    expect(result).toEqual({ ok: true, version: "2.1.303", executable: "/usr/local/bin/claude" });
    expect(JSON.stringify(result)).not.toContain("example.com");
    expect(calls).toEqual([
      "which claude",
      "/usr/local/bin/claude --version",
      "/usr/local/bin/claude auth status --json",
    ]);
  });

  it("an unreadable status counts as not logged in", async () => {
    const { run } = stub({
      "where claude": { stdout: EXE },
      [`${EXE} --version`]: { stdout: "2.1.303 (Claude Code)" },
      [`${EXE} auth status --json`]: { stdout: "Please log in" },
    });
    expect(await detectClaude(run, "win32", NOTHING)).toMatchObject({ ok: false, reason: "logged-out" });
  });

  it("a CLI that will not start is reported as an error with a way to see why", async () => {
    const { run } = stub({ "where claude": { stdout: EXE }, [`${EXE} --version`]: { code: 1 } });
    expect(await detectClaude(run, "win32", NOTHING)).toMatchObject({ ok: false, reason: "error" });
  });

  describe("installed but not on the PATH", () => {
    const installed = claudeInstallPath("win32", HOME);

    it("uses the executable in the installer's folder for the checks and for the session", async () => {
      const { run, calls } = stub({
        "where claude": { code: 1, stderr: "INFO: Could not find files" },
        [`${installed} --version`]: { stdout: "2.1.303 (Claude Code)\n" },
        [`${installed} auth status --json`]: { stdout: '{"loggedIn":true}' },
      });
      const result = await detectClaude(run, "win32", installedAt("win32"));
      expect(result).toEqual({ ok: true, version: "2.1.303", executable: installed });
      expect(calls).toEqual(["where claude", `${installed} --version`, `${installed} auth status --json`]);
    });

    it("does not report Claude Code as missing", async () => {
      const { run } = stub({
        "where claude": { code: 1 },
        [`${installed} --version`]: { stdout: "2.1.303 (Claude Code)" },
        [`${installed} auth status --json`]: { stdout: '{"loggedIn":false}' },
      });
      const result = await detectClaude(run, "win32", installedAt("win32"));
      expect(result).toMatchObject({ ok: false, reason: "logged-out" });
    });

    it("reports that it did not start when the copy in the folder fails to run", async () => {
      const { run } = stub({ "where claude": { code: 1 }, [`${installed} --version`]: { code: 1 } });
      expect(await detectClaude(run, "win32", installedAt("win32"))).toMatchObject({
        ok: false,
        reason: "error",
      });
    });

    it("is still missing when the folder has no executable", async () => {
      const { run } = stub({ "where claude": { code: 1 } });
      expect(await detectClaude(run, "win32", NOTHING)).toMatchObject({ ok: false, reason: "missing" });
    });
  });
});

describe("findClaude", () => {
  it("prefers a runnable file among the matches `where` lists", async () => {
    const { run } = stub({
      "where claude": { stdout: "C:\\npm\\claude\r\nC:\\npm\\claude.cmd\r\n" },
    });
    expect(await findClaude(run, "win32", NOTHING)).toBe("C:\\npm\\claude.cmd");
  });

  it("finds the installer's executable when the PATH has none", async () => {
    const { run } = stub({ "where claude": { code: 1 } });
    expect(await findClaude(run, "win32", installedAt("win32"))).toBe(
      join(HOME, ".local", "bin", "claude.exe"),
    );
  });

  it("lets the PATH win over the installer's folder", async () => {
    const { run } = stub({ "where claude": { stdout: "C:\\npm\\claude.cmd\r\n" } });
    expect(await findClaude(run, "win32", installedAt("win32"))).toBe("C:\\npm\\claude.cmd");
  });

  it("looks in the folder when the PATH lookup itself cannot run", async () => {
    const { run } = stub({}); // `which` is not even available
    expect(await findClaude(run, "linux", installedAt("linux"))).toBe(join(HOME, ".local", "bin", "claude"));
  });

  it("is null when neither has it", async () => {
    const { run } = stub({ "which claude": { code: 1 } });
    expect(await findClaude(run, "linux", NOTHING)).toBeNull();
  });
});

describe("the installer's folder", () => {
  it("is .local/bin under the user's home, with claude.exe on Windows and claude elsewhere", () => {
    expect(claudeInstallFolder("/h")).toBe(join("/h", ".local", "bin"));
    expect(claudeInstallPath("win32", "/h")).toBe(join("/h", ".local", "bin", "claude.exe"));
    expect(claudeInstallPath("darwin", "/h")).toBe(join("/h", ".local", "bin", "claude"));
    expect(claudeInstallPath("linux", "/h")).toBe(join("/h", ".local", "bin", "claude"));
  });
});
