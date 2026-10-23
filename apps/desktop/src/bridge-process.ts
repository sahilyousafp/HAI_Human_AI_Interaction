import { spawn } from "node:child_process";
import type { Readable } from "node:stream";

export interface BridgeSession {
  port: number;
  token: string;
}

/** The part of Electron's UtilityProcess (and of a Node child with a channel) the app uses. */
export interface ChildLike {
  pid?: number;
  stdout?: Readable | null;
  stderr?: Readable | null;
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  kill(): boolean;
}

/** Starts the bridge bundle in a separate process with this environment. */
export type Fork = (entry: string, env: NodeJS.ProcessEnv) => ChildLike;

export interface StartBridgeOptions {
  fork: Fork;
  /** The bridge bundle (dist/bridge/main.js). */
  entry: string;
  /** Where the bridge keeps `.hai/`: settings, the session file, conversations and the sample project. */
  workspace: string;
  /** The only origin the bridge accepts connections from. */
  origin: string;
  /** The sample project the bridge seeds a new workspace with. */
  sampleScene: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  /** How long the bridge has to report ready. */
  readyTimeoutMs?: number;
  /** How long it has to stop after being asked, before its process tree is ended. */
  stopTimeoutMs?: number;
  /** Ends a process and everything it started. */
  killTree?: (pid: number) => void;
}

export interface BridgeHandle {
  /** Resolves when the bridge listens; rejects with what it printed if it stops first or is too slow. */
  session: Promise<BridgeSession>;
  /** Asks the bridge to stop (it ends its agents first), then ends its process tree if it does not. */
  stop(): Promise<void>;
}

const OUTPUT_TAIL = 2000;

const isReady = (message: unknown): message is { type: "ready" } & BridgeSession =>
  typeof message === "object" &&
  message !== null &&
  (message as { type?: unknown }).type === "ready" &&
  Number.isInteger((message as { port?: unknown }).port) &&
  typeof (message as { token?: unknown }).token === "string";

/** `taskkill /T` on Windows, where killing the bridge alone would leave the agents it started running. */
function endTree(pid: number): void {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

export function startBridge(options: StartBridgeOptions): BridgeHandle {
  const { readyTimeoutMs = 20_000, stopTimeoutMs = 5_000, killTree = endTree } = options;
  const child = options.fork(options.entry, {
    ...process.env,
    ...options.env,
    HAI_PORT: "0", // the operating system picks a free port
    HAI_WORKSPACE: options.workspace,
    HAI_ALLOWED_ORIGINS: options.origin,
    HAI_SAMPLE_SCENE: options.sampleScene,
  });

  let tail = "";
  const collect = (chunk: unknown) => {
    const text = String(chunk);
    tail = (tail + text).slice(-OUTPUT_TAIL);
    for (const line of text.split(/\r?\n/)) if (line) options.log?.(line);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  let exited = false;
  let onExit: () => void = () => {};
  const exit = new Promise<void>((resolve) => {
    onExit = resolve;
  });

  const session = new Promise<BridgeSession>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`The bridge did not report ready within ${readyTimeoutMs / 1000} s.\n${tail}`));
      if (child.pid !== undefined) killTree(child.pid);
    }, readyTimeoutMs);
    child.on("message", (message) => {
      if (!isReady(message)) return;
      clearTimeout(timer);
      resolve({ port: message.port, token: message.token });
    });
    child.on("exit", (code) => {
      exited = true;
      clearTimeout(timer);
      reject(new Error(`The bridge stopped before it was ready (exit code ${code}).\n${tail}`));
      onExit();
    });
  });
  // A rejection nobody awaited (the app quit first) must not become an unhandled one.
  session.catch(() => {});

  return {
    session,
    async stop() {
      if (exited) return;
      child.postMessage({ type: "stop" });
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          if (!exited && child.pid !== undefined) killTree(child.pid);
          resolve();
        }, stopTimeoutMs);
      });
      await Promise.race([exit, late]);
      clearTimeout(timer);
      // Give the tree a moment to go after a forced end.
      if (!exited) await Promise.race([exit, new Promise((r) => setTimeout(r, 2000))]);
    },
  };
}
