import type { UpdateState } from "@hai/protocol";

/** The part of electron-updater's `autoUpdater` the app uses, so the logic around it can be tested without the network. */
export interface AppUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "update-available", listener: (info: { version: string }) => void): unknown;
  on(event: "update-not-available", listener: () => void): unknown;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  on(event: "update-downloaded", listener: (info: { version: string }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface UpdatesOptions {
  /** Null when updates cannot work here (running from the repository): the state says so and nothing is checked. */
  updater: AppUpdater | null;
  /** The version that is running. */
  current: string;
  /** Whether the app looks for updates by itself (on start, then daily). The user's choice; checks they ask for always run. */
  autoCheck: boolean;
  /** Ends what must end before the program is replaced (the bridge and its agents). */
  beforeRestart(): Promise<void>;
  log?: (line: string) => void;
  now?: () => number;
  /** How often to look while the app is open. */
  checkEveryMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Updates {
  state(): UpdateState;
  /** Looks for a newer version. Joins a check that is running; does nothing while a download is. */
  check(): Promise<void>;
  /** Downloads the version the last check found. Only after the user has been told about it and asked for it. */
  download(): Promise<void>;
  /** Replaces the program with the downloaded version and starts it. Refused while the agent is working. */
  restart(): Promise<boolean>;
  /** The agent is working (or is not): an update that is ready waits to restart until it is not. */
  setBusy(busy: boolean): void;
  setAutoCheck(on: boolean): void;
  /** Starts the automatic checks if they are on: one now, then one a day. */
  start(): void;
  stop(): void;
  onChange(listener: (state: UpdateState) => void): () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Updates from the release the app was installed from. It looks when asked and, if the user allows it, on start and once
 * a day; it tells the user what it found and downloads only when they say so; and it restarts only when no agent turn is
 * running. electron-updater checks the downloaded file against the hash in the feed (and, for a signed release, the
 * publisher's signature) before it is used, and refuses a file that does not match: the installed version then keeps
 * working and the state says the update failed.
 */
export function createUpdates(options: UpdatesOptions): Updates {
  const { updater, current, log = () => {}, checkEveryMs = DAY_MS } = options;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  const listeners = new Set<(state: UpdateState) => void>();

  let autoCheck = options.autoCheck;
  let busy = false;
  let checkedAt: number | null = null;
  let timer: unknown = null;
  /** `start()` has been called: the daily check runs (or will, once the user turns automatic checks on). */
  let started = false;
  let pending: Promise<void> | null = null;
  /** Whether the check under way is one the user asked for: only those show their failure. */
  let askedFor = false;
  let state: UpdateState = updater
    ? { current, autoCheck, status: "idle", checkedAt: null }
    : { current, autoCheck, status: "unavailable" };

  const set = (next: UpdateState) => {
    state = next;
    for (const listener of listeners) listener(state);
  };
  const base = () => ({ current, autoCheck });
  /** The state as it is now: a closure may have changed it since the code around a call last looked. */
  const now_ = (): UpdateState => state;
  const idle = () =>
    set({
      ...base(),
      status: "idle",
      checkedAt: checkedAt === null ? null : new Date(checkedAt).toISOString(),
    });

  if (updater) {
    updater.autoDownload = false; // nothing is downloaded until the user says so
    updater.autoInstallOnAppQuit = false; // nor installed behind their back when they close the app
    updater.on("update-available", (info) => {
      checkedAt = now();
      set({ ...base(), status: "available", version: info.version });
    });
    updater.on("update-not-available", () => {
      checkedAt = now();
      idle();
    });
    updater.on("download-progress", (progress) => {
      if (state.status === "downloading") set({ ...state, percent: Math.round(progress.percent) });
    });
    updater.on("update-downloaded", (info) => {
      set({ ...base(), status: "ready", version: info.version, canRestart: !busy });
    });
    updater.on("error", (error) => {
      log(`update: ${error.message}`);
      // A failed download or verification is always shown (the user asked for it); a quiet check that could not reach the
      // feed (no network) is not worth interrupting anyone for.
      if (state.status === "downloading") {
        set({
          ...base(),
          status: "error",
          message: `The update could not be installed: ${error.message}. HAI ${current} is still installed and works as before.`,
        });
      } else if (askedFor && state.status === "checking") {
        set({ ...base(), status: "error", message: `Could not look for updates: ${error.message}` });
      } else if (state.status === "checking") {
        idle();
      }
    });
  }

  async function check(): Promise<void> {
    if (!updater) return;
    if (pending) return pending;
    if (state.status === "downloading") return;
    askedFor = true;
    return runCheck();
  }

  function runCheck(): Promise<void> {
    if (!updater || pending) return pending ?? Promise.resolve();
    // An update already found, or downloaded, stays: looking again must not take it away.
    if (state.status === "available" || state.status === "ready") return Promise.resolve();
    set({ ...base(), status: "checking" });
    pending = updater
      .checkForUpdates()
      .then(() => {
        // The answer arrives as an event; one that did not come (a feed with nothing new that sends no event) ends here.
        if (state.status === "checking") idle();
      })
      .catch((error: Error) => {
        log(`update: ${error.message}`);
        if (state.status === "checking") {
          if (askedFor)
            set({ ...base(), status: "error", message: `Could not look for updates: ${error.message}` });
          else idle();
        }
      })
      .finally(() => {
        pending = null;
        askedFor = false;
      });
    return pending;
  }

  const automatic = () => {
    if (autoCheck) void runCheck();
  };

  return {
    state: () => state,
    check,
    async download() {
      if (!updater || state.status !== "available") return;
      const version = state.version;
      set({ ...base(), status: "downloading", version, percent: 0 });
      try {
        await updater.downloadUpdate();
      } catch (error) {
        const message = (error as Error).message;
        log(`update: ${message}`);
        // The error event usually got there first; make sure the user is told either way.
        if (now_().status === "downloading") {
          set({
            ...base(),
            status: "error",
            message: `The update could not be installed: ${message}. HAI ${current} is still installed and works as before.`,
          });
        }
      }
    },
    async restart() {
      if (!updater || state.status !== "ready" || busy) return false;
      await options.beforeRestart();
      updater.quitAndInstall(false, true);
      return true;
    },
    setBusy(next) {
      busy = next;
      if (state.status === "ready" && state.canRestart === busy) set({ ...state, canRestart: !busy });
    },
    setAutoCheck(on) {
      autoCheck = on;
      if (!on && timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      if (on && timer === null && started) timer = setTimer(automatic, checkEveryMs);
      set({ ...state, autoCheck: on });
      if (on) automatic();
    },
    start() {
      started = true;
      if (!updater) return;
      if (autoCheck) {
        automatic();
        timer ??= setTimer(automatic, checkEveryMs);
      }
    },
    stop() {
      started = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
