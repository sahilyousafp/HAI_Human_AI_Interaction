// What the desktop app's main process tells the page about first-run setup, and what the page may ask of it. The page
// reaches it through `window.haiDesktop`, which the desktop app's preload script provides; in a plain browser there is
// no such object, and the setup screens never show.

/** One thing to fetch, as the screen lists it: a folder of model files (`kokoro`, `moonshine-base`) and its size. */
export interface ModelItem {
  id: string;
  bytes: number;
}

/** Where the voice models stand. `needed` and `failed` carry what is still to fetch, for the screen to show. */
export type ModelsState =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "needed"; files: number; totalBytes: number; items: ModelItem[] }
  | {
      status: "downloading";
      /** The file being fetched now, such as `models/kokoro/onnx/model.onnx`. */
      file: string;
      /** 1-based position among the files still to fetch. */
      fileNumber: number;
      fileCount: number;
      receivedBytes: number;
      totalBytes: number;
      /** Everything this run fetches, in the order it fetches it, so the screen can show which are done. */
      items: ModelItem[];
    }
  | {
      status: "failed";
      /** `offline`: the host could not be reached. `server`: it answered with an error. `rejected`: the file's hash was wrong. */
      reason: "offline" | "server" | "rejected";
      file: string;
      message: string;
      files: number;
      totalBytes: number;
      receivedBytes: number;
      /** What is still to fetch. */
      items: ModelItem[];
    };

/** What the first-run screen shows before it installs Claude Code: the exact command, where it comes from, and a fallback. */
export interface ClaudeInstallInfo {
  /** Run word for word, as it is shown. */
  command: string;
  /** The address the installer script is downloaded from. */
  source: string;
  /** The official instructions, for a person who prefers to install by hand or when the install fails. */
  instructionsUrl: string;
}

/** Something Claude Code needs on this computer before it works, and whether it is there. */
export interface PrerequisiteStatus {
  id: string;
  label: string;
  why: string;
  ok: boolean;
}

/**
 * Where Claude Code stands. `broken` is installed but did not start. `signing-in` is the terminal the user was sent to
 * for the sign-in, which the app waits on. Install output is shown as it arrives and kept when an install fails.
 */
export type ClaudeState =
  | { status: "checking" }
  | { status: "ready"; version: string }
  | { status: "missing" }
  | { status: "broken" }
  | { status: "signed-out" }
  | { status: "installing"; output: string[] }
  | { status: "install-failed"; output: string[]; message: string }
  | { status: "signing-in" };

export interface ClaudeSetup {
  state: ClaudeState;
  prerequisites: PrerequisiteStatus[];
  info: ClaudeInstallInfo;
}

/**
 * Where updating the app stands. `current` is the version that is running, `autoCheck` whether the app looks for updates by
 * itself. `unavailable` means this copy cannot update (it is running from the repository). An update is only downloaded
 * after the user asked for it (`available` waits for that), and only restarted into when no agent turn is running.
 */
export type UpdateState = { current: string; autoCheck: boolean } & (
  | { status: "unavailable" }
  | { status: "idle"; checkedAt: string | null }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string; canRestart: boolean }
  | { status: "error"; message: string }
);

/** The desktop app's setup API as the page sees it. */
export interface DesktopApi {
  models: {
    /** The current state; the first answer may be `checking`. */
    state(): Promise<ModelsState>;
    /** Fetches the missing voice models; resolves when it has finished or failed (the state says which). */
    start(): Promise<void>;
    /** Stops a download in progress, keeping what has arrived so the next start continues from it. */
    cancel(): Promise<void>;
    /** Runs `listener` on every change of state. Returns a function that stops listening. */
    onChange(listener: (state: ModelsState) => void): () => void;
  };
  claude: {
    /** The current state; the first answer may be `checking`. */
    state(): Promise<ClaudeSetup>;
    /** Looks again now (after an install or a sign-in) and answers with what it found. */
    recheck(): Promise<ClaudeSetup>;
    /** Installs Claude Code with Anthropic's own installer. Only call after the user has seen `info.command` and agreed. */
    install(): Promise<void>;
    /** Opens a terminal window running `claude`, so the user can sign in there. */
    openSignIn(): Promise<void>;
    /** Runs `listener` on every change of state. Returns a function that stops listening. */
    onChange(listener: (setup: ClaudeSetup) => void): () => void;
  };
  updates: {
    state(): Promise<UpdateState>;
    /** Looks for a newer version now. */
    check(): Promise<void>;
    /** Downloads the version a check found. Only after the user pressed the button that offers it. */
    download(): Promise<void>;
    /** Restarts into the downloaded version. Answers false when it did not (an agent turn is running). */
    restart(): Promise<boolean>;
    /** Tells the app whether an agent turn is running, so an update waits to restart until it is not. */
    setBusy(busy: boolean): Promise<void>;
    /** Turns the automatic checks (on start, then daily) on or off. */
    setAutoCheck(on: boolean): Promise<void>;
    onChange(listener: (state: UpdateState) => void): () => void;
  };
}
