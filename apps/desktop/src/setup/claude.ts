import type { Detection } from "@hai/agent-core";
import type { ClaudeInstallInfo, ClaudeSetup, ClaudeState, PrerequisiteStatus } from "@hai/protocol";
import type { Prerequisite } from "./claude-install.ts";
import type { InstallRunner } from "./install-runner.ts";

/** A prerequisite with the way to tell whether this computer has it. */
export type CheckedPrerequisite = Prerequisite & { check(): Promise<boolean> };

export interface ClaudeSetupOptions {
  /** The shared checks (`claude --version`, `claude auth status`): the same ones the agent session runs. */
  detect(): Promise<Detection>;
  info: ClaudeInstallInfo;
  prerequisites?: readonly CheckedPrerequisite[];
  /** Runs Anthropic's installer. Called only by `install()`, which the screen calls only after the user pressed Install. */
  runInstaller?: InstallRunner;
  /** Where `claude` is, for the sign-in terminal (detection reports an executable only when it is signed in). */
  findExecutable?(): Promise<string | null>;
  /** Opens a visible terminal running Claude Code's sign-in. Called only by `openSignIn()`. */
  openTerminal?(executable: string): Promise<void>;
  /** How often to look while the user signs in (they are in a terminal and a browser, not in this window). */
  signInPollMs?: number;
  /** The least time between two lines of install output reported to the page, so a chatty installer does not flood it. */
  outputIntervalMs?: number;
  /** The least time between two checks nobody asked for (the window regaining focus). */
  focusCooldownMs?: number;
  now?: () => number;
}

export interface ClaudeSetupHolder {
  snapshot(): ClaudeSetup;
  /** Looks again now and answers with what it found. Joins a check that is already running. */
  recheck(): Promise<ClaudeSetup>;
  /**
   * Installs Claude Code, showing its output as it arrives, then looks again. Does nothing until it is called. Joins an
   * install already running, and does nothing when Claude Code is already ready.
   */
  install(): Promise<void>;
  /**
   * Opens a terminal window running Claude Code's own sign-in and waits for the user to finish it there: the screen
   * moves on when `claude auth status` says an account is signed in. Nothing the terminal prints is read.
   */
  openSignIn(): Promise<void>;
  /** A check nobody asked for: skipped when one ran a moment ago or when an install or sign-in is under way. */
  recheckOnFocus(): Promise<void>;
  onChange(listener: (setup: ClaudeSetup) => void): () => void;
}

/** Plain states for the first-run screen, from what detection reports. */
export function stateFromDetection(detection: Detection): ClaudeState {
  if (detection.ok) return { status: "ready", version: detection.version };
  switch (detection.reason) {
    case "missing":
      return { status: "missing" };
    case "error":
      return { status: "broken" };
    case "logged-out":
      return { status: "signed-out" };
  }
}

/**
 * What the first-run screen knows about Claude Code: ready, not installed, installed but not starting, or not signed
 * in. It only asks the shared detection, which uses Claude Code's own commands and reads nothing but whether an
 * account is signed in, so no credential passes through it.
 */
export function createClaudeSetup(options: ClaudeSetupOptions): ClaudeSetupHolder {
  const {
    info,
    prerequisites = [],
    focusCooldownMs = 2000,
    outputIntervalMs = 100,
    signInPollMs = 3000,
    now = Date.now,
  } = options;
  const listeners = new Set<(setup: ClaudeSetup) => void>();
  let state: ClaudeState = { status: "checking" };
  let prerequisiteStatus: PrerequisiteStatus[] = prerequisites.map(({ id, label, why }) => ({
    id,
    label,
    why,
    ok: false,
  }));
  let checking: Promise<ClaudeSetup> | null = null;
  let lastCheck = Number.NEGATIVE_INFINITY;

  const snapshot = (): ClaudeSetup => ({ state, prerequisites: prerequisiteStatus, info });
  const publish = () => {
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };
  const set = (next: ClaudeState) => {
    state = next;
    publish();
  };
  /** An install or a sign-in is in progress: a check now would only get in its way. */
  const busy = () => state.status === "installing";

  async function check(): Promise<ClaudeSetup> {
    const [detection, ok] = await Promise.all([
      options.detect(),
      Promise.all(prerequisites.map((p) => p.check().catch(() => false))),
    ]);
    lastCheck = now();
    prerequisiteStatus = prerequisites.map(({ id, label, why }, i) => ({
      id,
      label,
      why,
      ok: ok[i] === true,
    }));
    const found = stateFromDetection(detection);
    // The user is signing in in the terminal: until an account shows up, that is still what is going on.
    set(state.status === "signing-in" && found.status === "signed-out" ? state : found);
    return snapshot();
  }

  const OUTPUT_LINES = 200;
  let installing: Promise<void> | null = null;

  async function runInstall(runner: InstallRunner): Promise<void> {
    const output: string[] = [];
    let lastEmit = 0;
    set({ status: "installing", output: [] });
    const result = await runner((line) => {
      output.push(line);
      if (output.length > OUTPUT_LINES) output.splice(0, output.length - OUTPUT_LINES);
      const at = now();
      if (at - lastEmit >= outputIntervalMs) {
        lastEmit = at;
        set({ status: "installing", output: [...output] });
      }
    });
    if (result.startError || result.code !== 0) {
      set({
        status: "install-failed",
        output: [...output],
        message: result.startError
          ? `The installer could not be started: ${result.startError}`
          : `The installer stopped with an error (exit code ${result.code}).`,
      });
      return;
    }
    // It said it finished: look again, which is what moves the screen on (ready, or on to the sign-in).
    state = { status: "checking" };
    await check();
  }

  const SIGN_IN_POLLS_MAX = 200; // about ten minutes at the default pace
  let polling: ReturnType<typeof setTimeout> | null = null;

  /** Looks now and then while the user signs in, so the screen moves on without a click when they are done. */
  function pollSignIn(left = SIGN_IN_POLLS_MAX): void {
    if (polling) clearTimeout(polling);
    if (left <= 0) return;
    polling = setTimeout(async () => {
      polling = null;
      if (state.status !== "signing-in") return;
      await recheck();
      if (state.status === "signing-in") pollSignIn(left - 1);
    }, signInPollMs);
  }

  async function openSignIn(): Promise<void> {
    const { findExecutable, openTerminal } = options;
    if (!findExecutable || !openTerminal) throw new Error("Signing in from here is not available.");
    const executable = await findExecutable();
    if (!executable) throw new Error("Claude Code is not installed yet.");
    await openTerminal(executable);
    set({ status: "signing-in" });
    pollSignIn();
  }

  const install = (): Promise<void> => {
    if (installing) return installing;
    if (state.status === "ready") return Promise.resolve();
    const runner = options.runInstaller;
    if (!runner) return Promise.reject(new Error("Installing Claude Code is not available here."));
    installing = runInstall(runner).finally(() => {
      installing = null;
    });
    return installing;
  };

  const recheck = (): Promise<ClaudeSetup> => {
    if (busy()) return Promise.resolve(snapshot());
    checking ??= check().finally(() => {
      checking = null;
    });
    return checking;
  };

  return {
    snapshot,
    recheck,
    install,
    openSignIn,
    async recheckOnFocus() {
      if (busy() || checking || now() - lastCheck < focusCooldownMs) return;
      await recheck();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
