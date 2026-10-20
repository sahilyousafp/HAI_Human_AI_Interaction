import type { AgentEvent, McpServerSpec } from "@aex/protocol";

/** Whether the provider can run here, and if not, what the user should do. */
export type Detection =
  | { ok: true; version: string; executable: string }
  | {
      ok: false;
      reason: "missing" | "logged-out" | "error";
      /** What is wrong, in a sentence. */
      message: string;
      /** The next step for the user. */
      fix: string;
    };

export interface StartOptions {
  /** The open project folder: the agent's working directory, so its project-level setup applies. */
  cwd: string;
  /** Extra MCP servers for this session (the app's own scene tools), as an MCP config file. */
  mcpConfigPath: string;
  /** Text appended to the agent's system prompt (units, axes, which tools act on the scene). */
  systemPromptPath: string;
  /** Tool the provider calls to ask whether a tool call may run, e.g. "mcp__aex__approve_tool". */
  permissionPromptTool: string;
  /** Continue this earlier conversation instead of starting a new one. */
  resumeSessionId?: string;
}

/**
 * One long-lived conversation with an agent process. Each `send` is a turn; its events end with `turn.end`.
 * Turns are sequential: send the next one after the previous one ended.
 */
export interface AgentSession {
  /** The provider's conversation id, known once the session has initialised (needed to resume it later). */
  readonly sessionId: string | undefined;
  send(text: string): AsyncIterable<AgentEvent>;
  /** Asks the running turn to stop; the turn then ends with reason "stopped". */
  interrupt(): Promise<void>;
  /** Ends the process. */
  close(): Promise<void>;
  /** Called once when the process exits; `expected` is false for a crash or kill from outside. */
  onExit(listener: (expected: boolean) => void): void;
}

/**
 * Project-level MCP servers, managed through the provider's own configuration so they also work when the user runs
 * the provider directly in that folder. Each method resolves when the change is written, or rejects with a reason.
 */
export interface ProviderExtensions {
  addServer(cwd: string, server: McpServerSpec): Promise<void>;
  removeServer(cwd: string, name: string): Promise<void>;
}

/** An agent the app can drive: the user's own Claude Code today; Codex or a local model later. */
export interface AgentProvider {
  readonly id: string;
  readonly label: string;
  detect(): Promise<Detection>;
  start(options: StartOptions): Promise<AgentSession>;
  /** Present when the provider can add and remove project MCP servers. */
  readonly extensions?: ProviderExtensions;
}
