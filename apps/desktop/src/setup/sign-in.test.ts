import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Detection } from "@hai/agent-core";
import type { ClaudeInstallInfo } from "@hai/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaudeSetup } from "./claude.ts";
import { openSignInTerminal, signInCommand } from "./sign-in.ts";

const INFO: ClaudeInstallInfo = { command: "c", source: "s", instructionsUrl: "u" };
const READY: Detection = { ok: true, version: "2.1.303", executable: "x" };
const SIGNED_OUT: Detection = { ok: false, reason: "logged-out", message: "m", fix: "f" };

describe("signInCommand", () => {
  it("opens a new console window that runs `claude auth login` and stays open", () => {
    expect(signInCommand("C:\\Users\\me\\.local\\bin\\claude.exe")).toEqual({
      file: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        'start "Sign in to Claude" cmd.exe /d /k ""C:\\Users\\me\\.local\\bin\\claude.exe" auth login"',
      ],
    });
  });

  it("keeps the quotes round a path with spaces", () => {
    const { args } = signInCommand("C:\\Users\\Ada Lovelace\\.local\\bin\\claude.exe");
    expect(args.at(-1)).toContain('""C:\\Users\\Ada Lovelace\\.local\\bin\\claude.exe" auth login"');
  });

  it("can close the window when the sign-in ends, for tests", () => {
    expect(signInCommand("C:\\x\\claude.exe", { keepOpen: false }).args.at(-1)).toContain("cmd.exe /d /c ");
  });

  it.each([
    "C:\\a&calc\\claude.exe",
    "C:\\100%\\claude.exe",
    'C:\\a"b\\claude.exe',
    "C:\\a^b\\claude.exe",
    "C:\\a|b",
  ])("refuses a path cmd.exe would act on: %s", (path) => {
    expect(() => signInCommand(path)).toThrow(/cannot be passed safely/);
  });

  it("only runs the sign-in, never a login with a key or a token", () => {
    const text = signInCommand("C:\\x\\claude.exe").args.join(" ");
    expect(text).toContain("auth login");
    expect(text).not.toMatch(/token|api[-_ ]?key|--console|ANTHROPIC/i);
  });
});

describe("openSignInTerminal", () => {
  /** A stand-in for spawn that records how it was called and announces the child once. */
  function fakeSpawn(outcome: "spawn" | "error") {
    const calls: { file: string; args: string[]; options: Record<string, unknown> }[] = [];
    const child = Object.assign(new EventEmitter(), {
      unref: vi.fn(),
      stdout: null,
      stderr: null,
      stdin: null,
    });
    const spawnProcess = ((file: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ file, args, options });
      queueMicrotask(() =>
        outcome === "spawn" ? child.emit("spawn") : child.emit("error", new Error("ENOENT")),
      );
      return child;
    }) as unknown as Parameters<typeof openSignInTerminal>[1] extends infer O
      ? O extends { spawnProcess?: infer S }
        ? S
        : never
      : never;
    return { spawnProcess, calls, child };
  }

  it("starts the window and lets go of it: no pipes, detached, nothing read back", async () => {
    const { spawnProcess, calls, child } = fakeSpawn("spawn");
    await openSignInTerminal("C:\\x\\claude.exe", { spawnProcess, platform: "win32" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("cmd.exe");
    expect(calls[0]?.options).toMatchObject({
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: true,
    });
    expect(child.unref).toHaveBeenCalled();
    // Standard input, output and error are not connected, so none of what the window prints reaches the app.
    expect(child.stdout).toBeNull();
    expect(child.stderr).toBeNull();
  });

  it("reports that the window could not be opened", async () => {
    const { spawnProcess } = fakeSpawn("error");
    await expect(
      openSignInTerminal("C:\\x\\claude.exe", { spawnProcess, platform: "win32" }),
    ).rejects.toThrow("ENOENT");
  });

  it("says plainly that it is Windows only for now", async () => {
    const { spawnProcess, calls } = fakeSpawn("spawn");
    await expect(openSignInTerminal("/usr/bin/claude", { spawnProcess, platform: "linux" })).rejects.toThrow(
      /only available on Windows/,
    );
    expect(calls).toEqual([]);
  });

  // The real thing, on Windows: a program in a folder with a space in its name is run with `auth login` as its arguments.
  it.runIf(process.platform === "win32")(
    "really runs the program with `auth login`, from a path with spaces",
    async () => {
      const folder = join(mkdtempSync(join(tmpdir(), "hai-signin-")), "my folder");
      mkdirSync(folder);
      const marker = join(folder, "ran.txt");
      const program = join(folder, "claude.cmd");
      writeFileSync(program, `@echo off\r\necho %1 %2>"${marker}"\r\n`);
      await openSignInTerminal(program, { keepOpen: false });
      // The shell creates the file when it opens the redirect, a moment before the text is in it: wait for the text.
      const written = () => (existsSync(marker) ? readFileSync(marker, "utf8").trim() : "");
      for (let i = 0; i < 100 && !written(); i++) await new Promise((r) => setTimeout(r, 100));
      expect(written()).toBe("auth login");
    },
  );
});

describe("openSignIn", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(detections: Detection[]) {
    let at = 0;
    const openTerminal = vi.fn(async () => {});
    const detect = vi.fn(async () => detections[Math.min(at++, detections.length - 1)] as Detection);
    const holder = createClaudeSetup({
      detect,
      info: INFO,
      findExecutable: async () => "C:\\x\\claude.exe",
      openTerminal,
      signInPollMs: 3000,
    });
    return { holder, openTerminal, detect };
  }

  it("opens the terminal on the executable it found, and waits", async () => {
    const { holder, openTerminal } = setup([SIGNED_OUT]);
    await holder.recheck();
    await holder.openSignIn();
    expect(openTerminal).toHaveBeenCalledWith("C:\\x\\claude.exe");
    expect(holder.snapshot().state).toEqual({ status: "signing-in" });
  });

  it("moves on by itself when the account shows up, without anyone pressing anything", async () => {
    const { holder } = setup([SIGNED_OUT, SIGNED_OUT, SIGNED_OUT, READY]);
    await holder.recheck();
    await holder.openSignIn();
    await vi.advanceTimersByTimeAsync(3000); // still signed out
    expect(holder.snapshot().state.status).toBe("signing-in");
    await vi.advanceTimersByTimeAsync(3000); // still signed out
    expect(holder.snapshot().state.status).toBe("signing-in");
    await vi.advanceTimersByTimeAsync(3000); // signed in
    expect(holder.snapshot().state).toEqual({ status: "ready", version: "2.1.303" });
  });

  it("stops looking once it is done", async () => {
    const { holder, detect } = setup([SIGNED_OUT, READY]);
    await holder.recheck();
    await holder.openSignIn();
    await vi.advanceTimersByTimeAsync(3000);
    const calls = detect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(detect.mock.calls.length).toBe(calls);
  });

  it("stays on the sign-in while the user is away from the window, and a check they ask for moves it on", async () => {
    const { holder } = setup([SIGNED_OUT, SIGNED_OUT, READY]);
    await holder.recheck();
    await holder.openSignIn();
    expect((await holder.recheck()).state.status).toBe("signing-in");
    expect((await holder.recheck()).state.status).toBe("ready");
  });

  it("does not claim to be signing in when the terminal could not be opened", async () => {
    const holder = createClaudeSetup({
      detect: async () => SIGNED_OUT,
      info: INFO,
      findExecutable: async () => "C:\\x\\claude.exe",
      openTerminal: async () => {
        throw new Error("no console");
      },
    });
    await holder.recheck();
    await expect(holder.openSignIn()).rejects.toThrow("no console");
    expect(holder.snapshot().state.status).toBe("signed-out");
  });

  it("needs Claude Code to be installed", async () => {
    const holder = createClaudeSetup({
      detect: async () => SIGNED_OUT,
      info: INFO,
      findExecutable: async () => null,
      openTerminal: async () => {},
    });
    await expect(holder.openSignIn()).rejects.toThrow(/not installed/);
  });

  it("goes back to what is true if Claude Code goes missing meanwhile", async () => {
    const { holder } = setup([SIGNED_OUT, { ok: false, reason: "missing", message: "m", fix: "f" }]);
    await holder.recheck();
    await holder.openSignIn();
    expect((await holder.recheck()).state.status).toBe("missing");
  });
});
