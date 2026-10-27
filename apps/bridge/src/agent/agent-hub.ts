import { randomUUID } from "node:crypto";
import type { AgentProvider, AgentSession } from "@hai/agent-core";
import type {
  AgentEvent,
  AgentStatus,
  AgentTurn,
  ApprovalRequest,
  Message,
  RequestContext,
} from "@hai/protocol";
import { type Logger, silentLogger } from "../log.ts";
import {
  hasOutdatedSession,
  type ManagedDefinition,
  PERMISSION_TOOL,
  readSessionId,
  writeAgentConfig,
  writeSessionId,
} from "./agent-config.ts";

type Send = (message: Message) => void;

/** An idle session is closed after this long; the next request resumes the same conversation. */
export const IDLE_CLOSE_MS = 20 * 60_000;
/** How many turns the bridge keeps for a reloaded page. */
const TRANSCRIPT_TURNS = 50;

export interface TurnHooks {
  /** A turn began: open the scene transaction it will add to. */
  started?(turn: { id: string; request: string }): void;
  /** The user asked to stop the running turn: release anything it waits on (approvals). */
  stopping?(): void;
  /** A turn ended (done, stopped or error): commit its transaction. */
  ended?(turn: { id: string; request: string }): void;
  /** The session reported what it loaded (servers, tools, skills). */
  initialized?(event: Extract<AgentEvent, { type: "init" }>): void;
}

export interface AgentHubOptions {
  provider: AgentProvider;
  /** The open project folder: the agent's working directory. */
  projectDir(): string | null;
  /** Where the agent reaches the app's scene tools, and the token it must present. */
  mcp(): { url: string; token: string };
  idleMs?: number;
  hooks?: TurnHooks;
  /** Approval cards waiting for the user, for a page that connects later. */
  pending?(): ApprovalRequest[];
  log?: Logger;
  /**
   * The team agent this hub runs (`claude --agent <name>`): its own session id, files and transcript, and its name
   * on everything it broadcasts. Unset for the single unnamed session.
   */
  agent?: string;
  /** Added to the agent's system prompt when its process starts (the lead's roster of specialists). */
  extraPrompt?(): string | undefined;
  /** The agent's definition as the app runs it (its tools included), read when its process starts. */
  definition?(): ManagedDefinition | undefined;
  /** The read-only subagents the agent may start (`--agents` entries besides its own). */
  helpers?(): Record<string, ManagedDefinition> | undefined;
}

const id = () => randomUUID();

/** What kind of turn a request starts, for the team: the user's request, a specialist's task, or Mochi's report. */
export interface TurnMeta {
  kind?: AgentTurn["kind"];
  taskId?: string;
  /** A line the agent receives before the request but the transcript does not show (`[for: architect]`). */
  preface?: string;
}

const mm = (point: readonly number[]) => `${point.map((v) => Math.round(v)).join(", ")} mm`;

/**
 * The text the agent receives for a request that came with context: a compact block naming what the user pointed at
 * (a spoken request's references, a held pinch's target and the points P1, P2 the hand rested on), the sketches S1,
 * S2 the user drew and the project's lettered markers, then the request. The agent can still call get_user_context.
 */
export function withContext(text: string, context: RequestContext | undefined): string {
  if (!context) return text;
  const refs = context.references.length
    ? context.references.map((r, i) => `${i + 1}) ${r.type} ${r.id} "${r.name}"`).join(", ")
    : "none";
  const selection = context.selection.length ? context.selection.join(", ") : "none";
  const ground = context.groundPoint ? mm(context.groundPoint) : "none";
  let line = `[context] references: ${refs}; selection: ${selection}; ground point: ${ground}`;
  const target = context.target;
  if (target)
    line +=
      target.kind === "element"
        ? `; target ("this"): ${target.type} ${target.id} "${target.name}"`
        : `; target ("this"): point ${mm(target.point)}${target.aid ? ` (${target.aid})` : ""}`;
  if (context.points?.length)
    line += `; points: ${context.points.map((p, i) => `P${i + 1} ${mm(p)}`).join(", ")}`;
  const lines = [line];
  if (context.sketches?.length) {
    const sketches = context.sketches.map(
      (s) =>
        `${s.label} ${s.kind}: ${s.points.map((p) => `(${p.map((v) => Math.round(v)).join(", ")})`).join(" ")} mm`,
    );
    lines.push(`[sketches] ${sketches.join("; ")}`);
  }
  if (context.markers?.length)
    lines.push(`[markers] ${context.markers.map((m) => `${m.letter} ${mm(m.point)}`).join("; ")}`);
  return `${lines.join("\n")}\n${text}`;
}

/**
 * The user's agent session, as the bridge runs it: one long-lived process per open project, sent each request as
 * a turn. The conversation id is kept in the project, so a crash, an idle close or a bridge restart resumes the
 * same conversation; the transcript is kept here, so a reloaded page shows it again.
 */
export class AgentHub {
  private status: AgentStatus = { state: "starting" };
  private readonly turns: AgentTurn[] = [];
  private session: AgentSession | null = null;
  /** The tools the running process was started with, which a conversation is only resumed under the same of. */
  private surface = "";
  private sessionProject: string | null = null;
  /** The previous process ended unexpectedly: the next turn resumes and is marked recovered. */
  private crashed = false;
  private running: AgentTurn | null = null;
  /** The latest request a client sent and the turn it started (a shake right after it stops that turn). */
  private lastRequest: { requestId: string; turnId: string } | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** An extension changed during a turn: restart once it ends. */
  private restartAfterTurn = false;
  /** Resolves once detection has finished (tests wait for it). */
  readonly ready: Promise<void>;
  private detecting: Promise<void> | null = null;

  constructor(
    private readonly options: AgentHubOptions,
    private readonly broadcast: Send,
  ) {
    this.ready = this.detect();
  }

  /**
   * Checks that the provider is installed and signed in. Run at start, and again whenever a page connects or a
   * request arrives while it was not, so installing or signing in and reloading the page is enough.
   */
  private detect(): Promise<void> {
    this.detecting ??= this.options.provider
      .detect()
      .then((detection) => {
        this.setStatus(
          detection.ok
            ? { state: "idle" }
            : { state: "unavailable", reason: detection.message, fix: detection.fix },
        );
      })
      .finally(() => {
        this.detecting = null;
      });
    return this.detecting;
  }

  get currentStatus(): AgentStatus {
    return this.status;
  }

  /** The turn running now, if any (for turn transactions and approvals). */
  get runningTurn(): AgentTurn | null {
    return this.running;
  }

  greet(send: Send): void {
    send({
      type: "agent.transcript",
      id: id(),
      payload: {
        turns: this.turns,
        status: this.status,
        pending: this.options.pending?.() ?? [],
        ...this.named,
      },
    });
    if (this.status.state === "unavailable") void this.detect();
  }

  /** Handles an agent message from a client. Returns false for other messages. */
  handle(message: Message, send: Send): boolean {
    if (message.type === "agent.send") {
      void this.request(message.payload.text, message.payload.context).catch((error: Error) => {
        this.log.info("agent request refused", { reason: error.message });
        this.reject(message.id, error.message, send);
      });
      if (this.running) this.lastRequest = { requestId: message.id, turnId: this.running.id };
      return true;
    }
    if (message.type === "agent.stopRequest") {
      // One session: the request can only be the turn running now.
      if (
        this.lastRequest?.requestId === message.payload.requestId &&
        this.running?.id === this.lastRequest.turnId
      )
        void this.stop();
      return true;
    }
    if (message.type === "agent.stop") {
      void this.stop();
      return true;
    }
    return false;
  }

  /**
   * Sends a request (and what it refers to, for a spoken one) as a new turn; resolves with the turn when it has
   * ended.
   */
  async request(text: string, context?: RequestContext, meta: TurnMeta = {}): Promise<AgentTurn> {
    if (this.status.state === "unavailable") await this.detect();
    if (this.status.state === "unavailable")
      throw new Error(`${this.status.reason} ${this.status.fix ?? ""}`.trim());
    if (this.running) throw new Error("The agent is still working on the previous request.");
    const projectDir = this.options.projectDir();
    if (!projectDir) throw new Error("Open a project first.");
    this.clearIdle();

    const turn: AgentTurn = {
      id: id(),
      request: text,
      ...(context ? { context } : {}),
      events: [],
      recovered: false,
      kind: meta.kind ?? "request",
      ...(meta.taskId ? { taskId: meta.taskId } : {}),
    };
    this.running = turn;
    try {
      const session = await this.ensureSession(projectDir);
      turn.recovered = this.crashed;
      this.crashed = false;
      this.turns.push(turn);
      if (this.turns.length > TRANSCRIPT_TURNS) this.turns.splice(0, this.turns.length - TRANSCRIPT_TURNS);
      this.broadcast({
        type: "agent.turn",
        id: id(),
        payload: {
          id: turn.id,
          request: text,
          ...(context ? { context } : {}),
          recovered: turn.recovered,
          kind: turn.kind,
          ...(turn.taskId ? { taskId: turn.taskId } : {}),
          ...this.named,
        },
      });
      this.setStatus({ state: "working" });
      this.options.hooks?.started?.(turn);
      const sent = withContext(text, context);
      for await (const event of session.send(meta.preface ? `${meta.preface}\n${sent}` : sent)) {
        turn.events.push(event);
        if (event.type === "turn.end")
          this.log.info("agent turn ended", { reason: event.reason, durationMs: event.durationMs });
        this.broadcast({ type: "agent.event", id: id(), payload: { turnId: turn.id, event, ...this.named } });
        if (event.type === "init") {
          if (event.sessionId) writeSessionId(projectDir, event.sessionId, this.options.agent, this.surface);
          this.options.hooks?.initialized?.(event);
        }
      }
    } finally {
      this.running = null;
      this.options.hooks?.ended?.(turn);
      if (
        this.status.state === "working" ||
        this.status.state === "starting" ||
        this.status.state === "recovering"
      ) {
        this.setStatus({ state: "idle" });
      }
      this.armIdle();
      if (this.restartAfterTurn) {
        this.restartAfterTurn = false;
        await this.close();
      }
    }
    return turn;
  }

  /**
   * Ends the agent process so the next request starts a new one with the changed setup (MCP servers, skills). The
   * conversation resumes. A running turn finishes first.
   */
  async restart(): Promise<void> {
    if (this.running) this.restartAfterTurn = true;
    else await this.close();
  }

  /** Stops the running turn; it ends within a few seconds and keeps what it already changed. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.options.hooks?.stopping?.();
    await this.session?.interrupt();
  }

  /** Ends the agent process (on bridge shutdown). */
  async close(): Promise<void> {
    this.clearIdle();
    const session = this.session;
    this.session = null;
    await session?.close();
  }

  private get log(): Logger {
    return this.options.log ?? silentLogger;
  }

  /** The agent's name, for the payloads it broadcasts. */
  private get named(): { agent?: string } {
    return this.options.agent ? { agent: this.options.agent } : {};
  }

  private async ensureSession(projectDir: string): Promise<AgentSession> {
    if (this.session && this.sessionProject === projectDir) return this.session;
    if (this.session) await this.close(); // another project is open now: its own conversation
    this.setStatus({ state: this.crashed ? "recovering" : "starting" });
    const { agent } = this.options;
    const extraPrompt = this.options.extraPrompt?.();
    const definition = this.options.definition?.();
    const helpers = this.options.helpers?.();
    this.surface = definition ? definition.tools.join(",") : "";
    const paths = writeAgentConfig(projectDir, this.options.mcp(), {
      ...(agent ? { agent } : {}),
      ...(extraPrompt ? { extraPrompt } : {}),
      ...(definition ? { definition } : {}),
      ...(helpers ? { helpers } : {}),
    });
    const resumeSessionId = readSessionId(projectDir, agent, this.surface);
    if (hasOutdatedSession(projectDir, agent, this.surface))
      this.log.info("saved conversation not resumed: it was started under older instructions", { agent });
    const session = await this.options.provider.start({
      cwd: projectDir,
      ...paths,
      permissionPromptTool: PERMISSION_TOOL,
      resumeSessionId,
      ...(agent ? { agent } : {}),
    });
    this.log.info("agent session started", {
      provider: this.options.provider.id,
      ...this.named,
      project: projectDir,
      resumed: Boolean(resumeSessionId),
      afterCrash: this.crashed,
    });
    this.session = session;
    this.sessionProject = projectDir;
    session.onExit((expected) => {
      if (this.session !== session) return;
      this.session = null;
      if (!expected) {
        this.crashed = true;
        this.log.error("agent process ended unexpectedly; the next request resumes the conversation");
      }
    });
    return session;
  }

  private armIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => void this.close(), this.options.idleMs ?? IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private setStatus(status: AgentStatus): void {
    this.status = status;
    this.broadcast({ type: "agent.status", id: id(), payload: { status, ...this.named } });
  }

  private reject(requestId: string, message: string, send: Send): void {
    send({ type: "request.error", id: id(), payload: { requestId, message } });
  }
}
