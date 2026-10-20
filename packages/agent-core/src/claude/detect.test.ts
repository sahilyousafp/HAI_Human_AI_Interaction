import { describe, expect, it } from "vitest";
import { detectClaude, findClaude } from "./detect.ts";
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

describe("detectClaude", () => {
  it("CLI missing: says Claude Code is not installed and how to install it", async () => {
    const { run } = stub({ "where claude": { code: 1, stderr: "INFO: Could not find files" } });
    const result = await detectClaude(run, "win32");
    expect(result).toMatchObject({ ok: false, reason: "missing", message: "Claude Code is not installed." });
    expect(result.ok === false && result.fix).toContain("https://");
  });

  it("not logged in: tells the user to run claude in a terminal and log in", async () => {
    const { run } = stub({
      "where claude": { stdout: `${EXE}\r\n` },
      [`${EXE} --version`]: { stdout: "2.1.303 (Claude Code)\n" },
      [`${EXE} auth status --json`]: { code: 1, stdout: '{"loggedIn":false,"authMethod":"none"}' },
    });
    const result = await detectClaude(run, "win32");
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
    const result = await detectClaude(run, "linux");
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
    expect(await detectClaude(run, "win32")).toMatchObject({ ok: false, reason: "logged-out" });
  });

  it("a CLI that will not start is reported as an error with a way to see why", async () => {
    const { run } = stub({ "where claude": { stdout: EXE }, [`${EXE} --version`]: { code: 1 } });
    expect(await detectClaude(run, "win32")).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("findClaude", () => {
  it("prefers a runnable file among the matches `where` lists", async () => {
    const { run } = stub({
      "where claude": { stdout: "C:\\npm\\claude\r\nC:\\npm\\claude.cmd\r\n" },
    });
    expect(await findClaude(run, "win32")).toBe("C:\\npm\\claude.cmd");
  });
});
