import type { ChildProcess } from "node:child_process";
import type { AgentEvent, McpServerSpec } from "@aex/protocol";
import spawn from "cross-spawn";
import type {
  AgentProvider,
  AgentSession,
  Detection,
  ProviderExtensions,
  StartOptions,
} from "../provider.ts";
import { detectClaude } from "./detect.ts";
import { mcpAddArgs, mcpRemoveArgs } from "./extensions.ts";
import { createClaudeMapper, createLineSplitter } from "./mapping.ts";
import { run as defaultRun, type Run } from "./run.ts";

/** How long an interrupt may take before the process is ended instead (the turn then stops within the 3 s bound). */
export const INTERRUPT_GRACE_MS = 1500;

/**
 * The arguments the user's own `claude` is started with. Deliberately absent: `--bare` (it ignores the
 * subscription login and skips the user's setup), `--strict-mcp-config`, `--tools` and `--setting-sources` (they
 * would hide the user's own MCP servers, skills and settings). docs/agent.md lists the same flags; a test keeps
 * them in step.
 */
export function buildClaudeArgs(options: StartOptions): string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--mcp-config",
    options.mcpConfigPath,
    "--permission-prompt-tool",
    options.permissionPromptTool,
    "--append-system-prompt-file",
    options.systemPromptPath,
    ...(options.resumeSessionId ? ["--resume", options.resumeSessionId] : []),
  ];
}

/** A queue of events that a turn's async iterator reads from; events before the first turn wait for it. */
class EventQueue {
  private readonly items: AgentEvent[] = [];
  private waiting: ((event: AgentEvent) => void) | null = null;

  push(event: AgentEvent): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(event);
    } else this.items.push(event);
  }

  next(): Promise<AgentEvent> {
    const item = this.items.shift();
    if (item) return Promise.resolve(item);
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }
}

/** Ends the agent process and everything it started (its MCP servers). */
function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

/** One running `claude -p` process: a conversation driven over stdin and stdout in stream-json. */
export class ClaudeCliSession implements AgentSession {
  private readonly queue = new EventQueue();
  private readonly map = createClaudeMapper();
  private readonly exitListeners: Array<(expected: boolean) => void> = [];
  private id: string | undefined;
  private turnActive = false;
  /** Called when the running turn ends (an interrupt waits for this rather than the whole grace period). */
  private turnEndWaiters: Array<() => void> = [];
  private interrupting = false;
  private closing = false;
  private exited = false;

  constructor(private readonly child: ChildProcess) {
    const split = createLineSplitter((line) => this.onLine(line));
    child.stdout?.on("data", (chunk: Buffer) => split(chunk.toString()));
    // stderr is not logged: it can carry account details. It is drained so the process never blocks on it.
    child.stderr?.resume();
    child.on("exit", () => this.handleExit());
    child.on("error", () => this.handleExit());
  }

  get sessionId(): string | undefined {
    return this.id;
  }

  async *send(text: string): AsyncIterable<AgentEvent> {
    if (this.exited) throw new Error("The agent process has ended.");
    if (this.turnActive) throw new Error("A turn is already running.");
    this.turnActive = true;
    this.interrupting = false;
    this.child.stdin?.write(
      `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`,
    );
    try {
      while (true) {
        const event = await this.queue.next();
        yield event;
        if (event.type === "turn.end") return;
      }
    } finally {
      this.turnActive = false;
      for (const resolve of this.turnEndWaiters.splice(0)) resolve();
    }
  }

  async interrupt(): Promise<void> {
    if (!this.turnActive || this.exited) return;
    this.interrupting = true;
    // The interrupt request the Agent SDK sends over the stream-json control channel (see docs/decisions.md).
    const request = {
      type: "control_request",
      request_id: `interrupt-${Date.now()}`,
      request: { subtype: "interrupt" },
    };
    this.child.stdin?.write(`${JSON.stringify(request)}\n`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      new Promise<void>((resolve) => this.turnEndWaiters.push(resolve)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, INTERRUPT_GRACE_MS);
      }),
    ]);
    clearTimeout(timer);
    if (this.turnActive && !this.exited) {
      // Not stopped in time: end the process; the next turn resumes the conversation in a new one.
      this.closing = true;
      killTree(this.child);
    }
  }

  async close(): Promise<void> {
    if (this.exited) return;
    this.closing = true;
    this.child.stdin?.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        killTree(this.child);
        resolve();
      }, 2000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  onExit(listener: (expected: boolean) => void): void {
    if (this.exited) listener(this.closing);
    else this.exitListeners.push(listener);
  }

  private onLine(line: string): void {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      return; // not stream-json (a stray print); ignore
    }
    for (const event of this.map(raw)) {
      if (event.type === "init") this.id = event.sessionId || this.id;
      if (event.type === "turn.end" && this.interrupting) {
        this.queue.push({ ...event, reason: "stopped" });
        continue;
      }
      if (event.type === "error" && this.interrupting) continue; // an interrupted turn is not an error
      this.queue.push(event);
    }
  }

  private handleExit(): void {
    if (this.exited) return;
    this.exited = true;
    if (this.turnActive) {
      if (this.interrupting) this.queue.push({ type: "turn.end", reason: "stopped" });
      else {
        this.queue.push({ type: "error", message: "The agent process ended unexpectedly." });
        this.queue.push({ type: "turn.end", reason: "error" });
      }
    }
    for (const listener of this.exitListeners) listener(this.closing);
  }
}

export interface ClaudeCliProviderOptions {
  run?: Run;
  /** Starts the agent process; replaced by a fake CLI in tests. */
  spawnProcess?: (executable: string, args: string[], cwd: string) => ChildProcess;
  /** Skip detection and use this executable (tests). */
  executable?: string;
}

/** The user's own Claude Code CLI, installed and logged in by them, started unmodified. */
export class ClaudeCliProvider implements AgentProvider {
  readonly id = "claude-code";
  readonly label = "Claude Code";
  private executable: string | undefined;

  constructor(private readonly options: ClaudeCliProviderOptions = {}) {
    this.executable = options.executable;
  }

  async detect(): Promise<Detection> {
    const detection = await detectClaude(this.options.run ?? defaultRun);
    if (detection.ok) this.executable = detection.executable;
    return detection;
  }

  /** Project MCP servers through `claude mcp add|remove --scope project`, run in the project folder. */
  readonly extensions: ProviderExtensions = {
    addServer: (cwd: string, server: McpServerSpec) =>
      this.mcp(cwd, mcpAddArgs(server), [
        ...Object.values(server.transport === "http" ? server.headers : server.env),
      ]),
    removeServer: (cwd: string, name: string) => this.mcp(cwd, mcpRemoveArgs(name), []),
  };

  /** Runs a `claude mcp` command; on failure rejects with the CLI's own message, any secret values masked. */
  private async mcp(cwd: string, args: string[], secrets: string[]): Promise<void> {
    const result = await (this.options.run ?? defaultRun)(this.executable ?? "claude", args, { cwd });
    if (result.code === 0) return;
    const output = result.error?.message ?? (result.stderr.trim() || result.stdout.trim());
    let message = output.split(/\r?\n/)[0] ?? "";
    for (const secret of secrets) if (secret) message = message.split(secret).join("••••");
    throw new Error(message || "Claude Code could not change the project's MCP servers.");
  }

  async start(options: StartOptions): Promise<AgentSession> {
    const executable = this.executable ?? "claude";
    const args = buildClaudeArgs(options);
    const child = this.options.spawnProcess
      ? this.options.spawnProcess(executable, args, options.cwd)
      : spawn(executable, args, { cwd: options.cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    return new ClaudeCliSession(child);
  }
}
