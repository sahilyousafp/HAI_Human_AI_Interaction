import { randomUUID } from "node:crypto";
import type { AgentProvider, Detection } from "@hai/agent-core";
import type {
  AgentDefinitionInput,
  AgentEvent,
  AgentStatus,
  AgentTurn,
  ApprovalRequest,
  Message,
  RequestContext,
  TeamTask,
} from "@hai/protocol";
import { type Logger, silentLogger } from "../log.ts";
import type { AgentTokens } from "../mcp/agent-tokens.ts";
import type { TeamTools } from "../mcp/scene-tools.ts";
import { HAI_SERVER, migrateSessionToLead } from "./agent-config.ts";
import { AgentHub, type TurnHooks } from "./agent-hub.ts";
import type { PanelClosure } from "./panels.ts";
import {
  allowedHaiTools,
  defaultRoster,
  ensureDefaultAgents,
  managedDefinition,
  memberInfo,
  readRoster,
  rosterText,
  saveDefinition,
  type TeamMember,
} from "./roster.ts";

type Send = (message: Message) => void;

/** The team's limits; docs/agents.md documents each, and a test keeps them in step. */
export const TEAM = {
  /** How many specialists work at the same time, unless set otherwise. Mochi is always available on top. */
  maxRunning: 3,
  /** Finished tasks kept on the board (and in status answers). */
  finishedKept: 30,
  /** A specialist's final reply is shortened to this for the board, status and Mochi's report. */
  summaryChars: 600,
  /** Text streaming in updates the board at most this often. */
  activityThrottleMs: 250,
} as const;
/** The lead's name when the project does not say otherwise. */
const DEFAULT_LEAD = "mochi";

const FINISHED: ReadonlySet<TeamTask["status"]> = new Set(["done", "failed", "stopped"]);
const ACTIVE: ReadonlySet<TeamTask["status"]> = new Set(["running", "waiting"]);

/** How an agent's name is shown and spoken: "architect" becomes "Architect". */
export const displayName = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

const shorten = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

const replyOf = (events: AgentEvent[]) =>
  events
    .filter((e): e is Extract<AgentEvent, { type: "text.delta" }> => e.type === "text.delta")
    .map((e) => e.text)
    .join("")
    .trim();

/** A client's request refused, with why. */
const refusal = (requestId: string, message: string): Message => ({
  type: "request.error",
  id: randomUUID(),
  payload: { requestId, message },
});

/** What an agent is told when the panel it opened was closed. */
function panelNote(closure: PanelClosure): string {
  const outcome =
    closure.outcome === "kept"
      ? "kept the result: it is in the model as one undo step"
      : "discarded the result: the model is as it was";
  const who = closure.by === "user" ? "The user closed" : "The app closed";
  return `[panel] ${who} the panel "${closure.title}" and ${outcome}. Reply in chat if it helps, and do not reopen it unless asked.`;
}

/** The report Mochi receives when the tasks it handed out in one turn have all finished. */
function digestText(tasks: TeamTask[]): string {
  const lines = tasks.map(
    (t) => `- ${displayName(t.agent)} "${t.title}": ${t.status}.${t.summary ? ` ${t.summary}` : ""}`,
  );
  return `[team] The tasks you handed out have finished. Tell the user briefly what was done.\n${lines.join("\n")}`;
}

export interface TeamOptions {
  provider: AgentProvider;
  /** The open project folder. */
  projectDir(): string | null;
  /** Where agents reach the app's MCP endpoint. */
  mcpUrl(): string;
  tokens: AgentTokens;
  /** The scene's undo grouping: one group per writing task. */
  scene: { beginTurn(label: string): void; endTurn(): void };
  approvals: { readonly waiting: ApprovalRequest[]; denyAll(message: string, agent?: string): void };
  /** Generated panels: an agent's turn ended or was stopped, so an offer it left unanswered is over. */
  panels?: { turnEnded(agent: string): void };
  /** An agent session reported what it loaded (servers, tools, skills). */
  initialized?(event: Extract<AgentEvent, { type: "init" }>): void;
  idleMs?: number;
  maxRunning?: number;
  log?: Logger;
}

/**
 * The project's agent team, as the bridge runs it: one session per agent (`AgentHub`), Mochi taking every request,
 * and the task board with its scheduler for the work Mochi hands to the specialists.
 *
 * - Up to `maxRunning` specialists work at once, each on one task at a time; later tasks queue.
 * - Only one agent that changes the model works at a time, so each writing task is one undo step, labelled
 *   "<Agent>: <title>". Agents that only read run alongside.
 * - When every task Mochi handed out in one turn has finished, Mochi gets a digest turn and reports.
 */
export class Team {
  private readonly hubs = new Map<string, AgentHub>();
  private members: TeamMember[] = [];
  /** The project the roster was read from. */
  private project: string | null = null;
  private tasks: TeamTask[] = [];
  /** Each specialist's task in progress (for its turn hooks and events). */
  private readonly activeTask = new Map<string, TeamTask>();
  /** The streamed reply of each running task. */
  private readonly replies = new Map<string, string>();
  /** Tasks the user or Mochi asked to stop. */
  private readonly stopping = new Set<string>();
  /** Mochi's turns whose hand-offs have been reported (or need no report). */
  private readonly reported = new Set<string>();
  private readonly digests: TeamTask[][] = [];
  /** What agents are to be told about panels they opened, until they are free to hear it. */
  private readonly panelNotes = new Map<string, string[]>();
  /** Note turns in progress (for settled()). */
  private readonly noteRuns = new Set<Promise<unknown>>();
  /** Mochi's report turn in progress (a user request waits for it). */
  private digestRunning: Promise<unknown> | null = null;
  /** The agent whose writing task holds the scene's undo group. */
  private groupOwner: string | null = null;
  /** What each agent's running process was started with, to restart it after its definition changes. */
  private readonly startedWith = new Map<string, string>();
  private lastDetection: Detection | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly settledWaiters: Array<() => void> = [];
  readonly ready: Promise<void>;

  constructor(
    private readonly options: TeamOptions,
    private readonly broadcast: Send,
  ) {
    this.ready = this.hub(DEFAULT_LEAD).ready;
  }

  get maxRunning(): number {
    return this.options.maxRunning ?? TEAM.maxRunning;
  }

  /** The lead's name: the project's lead, or Mochi. */
  get lead(): string {
    return this.members.find((m) => m.lead)?.name ?? DEFAULT_LEAD;
  }

  get currentStatus(): AgentStatus {
    return this.hub(this.lead).currentStatus;
  }

  get board(): TeamTask[] {
    return this.tasks.map((t) => ({ ...t }));
  }

  /** The session of one agent (created on first use). */
  hub(name: string): AgentHub {
    let hub = this.hubs.get(name);
    if (hub) return hub;
    hub = new AgentHub(
      {
        provider: this.providerFor(name),
        projectDir: () => this.options.projectDir(),
        mcp: () => {
          this.startedWith.set(name, this.fingerprint(name));
          const member = this.member(name);
          return {
            url: this.options.mcpUrl(),
            token: this.options.tokens.issue({
              agent: name,
              tools: member ? allowedHaiTools(member) : new Set<string>(),
            }),
          };
        },
        extraPrompt: () => (name === this.lead ? rosterText(this.members) : undefined),
        definition: () => {
          const member = this.member(name);
          return member ? managedDefinition(member) : undefined;
        },
        pending: () => this.options.approvals.waiting.filter((a) => a.agent === name),
        hooks: this.hooksFor(name),
        agent: name,
        log: this.log,
        ...(this.options.idleMs ? { idleMs: this.options.idleMs } : {}),
      },
      (message) => {
        this.observe(name, message);
        this.broadcast(message);
      },
    );
    this.hubs.set(name, hub);
    return hub;
  }

  /** Sends what is known to a newly connected page: every agent's conversation, then the board. */
  greet(send: Send): void {
    this.refreshRoster();
    this.hub(this.lead).greet(send);
    for (const [name, hub] of this.hubs) if (name !== this.lead) hub.greet(send);
    send(this.snapshot());
    send(this.definitions());
  }

  /** Handles a team message from a client. Returns false for other messages. */
  handle(message: Message, send: Send): boolean {
    if (message.type === "agent.send") {
      const { text, context, agent } = message.payload;
      void this.request(text, context, agent).catch((error: Error) => {
        this.log.info("agent request refused", { reason: error.message });
        send(refusal(message.id, error.message));
      });
      return true;
    }
    if (message.type === "agent.stop") {
      void this.stopAll();
      return true;
    }
    if (message.type === "agents.save") {
      try {
        this.saveAgent(message.payload.agent);
      } catch (error) {
        send(refusal(message.id, (error as Error).message));
      }
      return true;
    }
    if (message.type === "task.stop") {
      this.cancel(message.payload.id);
      return true;
    }
    return false;
  }

  /**
   * The user's request, for Mochi; `target` is the specialist the user named, which Mochi then hands it to.
   * Resolves when Mochi's turn has ended (its hand-offs keep running).
   */
  async request(text: string, context?: RequestContext, target?: string): Promise<AgentTurn> {
    this.ensureProject();
    const lead = this.hub(this.lead);
    if (this.digestRunning) await this.digestRunning;
    await this.restartIfChanged(this.lead);
    if (target && !this.member(target))
      throw new Error(`There is no agent called ${target} in this project.`);
    const preface = target && target !== this.lead ? `[for: ${target}]` : undefined;
    try {
      return await lead.request(text, context, { kind: "request", ...(preface ? { preface } : {}) });
    } finally {
      this.checkBatches();
      this.pumpDigests();
    }
  }

  /** The lead's tools on the MCP endpoint. */
  readonly tools: TeamTools = {
    delegate: (task) => this.delegate(task),
    status: () => this.status(),
    cancel: (taskId) => this.cancel(taskId),
  };

  /** Hands a task to a specialist: queued at once, started when the scheduler allows. */
  delegate(task: {
    agent: string;
    title: string;
    instruction: string;
  }): { ok: true; taskId: string; status: string } | { ok: false; error: string } {
    this.refreshRoster();
    const agent = task.agent.trim().toLowerCase();
    const member = this.member(agent);
    if (!member) {
      const names = this.members.filter((m) => !m.lead).map((m) => m.name);
      return {
        ok: false,
        error: `There is no specialist called ${task.agent}. The team: ${names.join(", ")}.`,
      };
    }
    if (member.lead) return { ok: false, error: "Hand tasks to the specialists, not to yourself." };
    const fromTurn = this.hub(this.lead).runningTurn?.id;
    const record: TeamTask = {
      id: randomUUID(),
      agent,
      title: shorten(task.title.trim(), 80),
      instruction: task.instruction.trim(),
      status: "queued",
      createdAt: Date.now(),
      ...(fromTurn ? { fromTurn } : {}),
    };
    this.tasks.push(record);
    this.log.info("task handed out", { agent });
    this.schedule();
    this.publish();
    return { ok: true, taskId: record.id, status: record.status };
  }

  /** What everyone is doing, for the lead's team_status tool. */
  status(): unknown {
    const now = Date.now();
    const brief = (t: TeamTask) => ({ id: t.id, title: t.title, status: t.status });
    return {
      agents: this.members
        .filter((m) => !m.lead)
        .map((m) => {
          const current = this.tasks.find((t) => t.agent === m.name && ACTIVE.has(t.status));
          const queued = this.tasks.filter((t) => t.agent === m.name && t.status === "queued");
          let state = queued.length ? "queued" : "idle";
          if (current) state = current.status === "waiting" ? "waiting for approval" : "working";
          return {
            name: m.name,
            state,
            ...(current
              ? {
                  task: {
                    ...brief(current),
                    instruction: shorten(current.instruction, 200),
                    lastActivity: current.lastActivity ?? null,
                    runningForSeconds: Math.round((now - (current.startedAt ?? now)) / 1000),
                  },
                }
              : {}),
            queued: queued.map(brief),
          };
        }),
      recentlyFinished: this.tasks
        .filter((t) => FINISHED.has(t.status))
        .slice(-5)
        .map((t) => ({ ...brief(t), agent: t.agent, summary: t.summary ?? "" })),
    };
  }

  /** Stops a running task or takes a queued one off the queue. */
  cancel(taskId: string): { ok: true; status: string } | { ok: false; error: string } {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return { ok: false, error: `No task ${taskId}.` };
    if (FINISHED.has(task.status)) return { ok: true, status: task.status };
    if (task.status === "queued") {
      this.finish(task, "stopped");
      return { ok: true, status: "stopped" };
    }
    this.stopping.add(task.id);
    void this.hub(task.agent).stop();
    return { ok: true, status: "stopping" };
  }

  /** Stops everything: Mochi's turn, every running task, and the queue. No report follows. */
  async stopAll(): Promise<void> {
    for (const task of this.tasks) {
      if (task.fromTurn) this.reported.add(task.fromTurn);
      if (task.status === "queued") this.finish(task, "stopped");
      else if (ACTIVE.has(task.status)) this.stopping.add(task.id);
    }
    this.digests.length = 0;
    await Promise.all([...this.hubs.values()].map((hub) => hub.stop()));
  }

  /** Restarts every agent process (an extension changed); each resumes its conversation. */
  async restart(): Promise<void> {
    await Promise.all([...this.hubs.values()].map((hub) => hub.restart()));
  }

  /**
   * A panel an agent opened has closed: the agent hears how, as a turn when it is idle (or right after the turn it
   * is in), the way Mochi hears a report. Nothing is sent when the agent closed it itself.
   */
  panelClosed(closure: PanelClosure): void {
    if (closure.by === "agent" || closure.agent === null) return;
    const notes = this.panelNotes.get(closure.agent) ?? [];
    notes.push(panelNote(closure));
    this.panelNotes.set(closure.agent, notes);
    this.pumpNotes(closure.agent);
  }

  /** The approval cards changed: a task waiting for the user shows as waiting. */
  approvalsChanged(): void {
    const waiting = new Set(this.options.approvals.waiting.map((a) => a.agent));
    let changed = false;
    for (const task of this.tasks) {
      if (!ACTIVE.has(task.status)) continue;
      const status = waiting.has(task.agent) ? "waiting" : "running";
      if (task.status !== status) {
        task.status = status;
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  /** Resolves once nothing is running, queued or waiting to be reported (for tests and shutdown). */
  settled(): Promise<void> {
    if (this.isSettled()) return Promise.resolve();
    return new Promise((resolve) => this.settledWaiters.push(resolve));
  }

  async close(): Promise<void> {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    await Promise.all([...this.hubs.values()].map((hub) => hub.close()));
  }

  private get log(): Logger {
    return this.options.log ?? silentLogger;
  }

  private member(name: string): TeamMember | undefined {
    return this.members.find((m) => m.name === name);
  }

  /** Reads the open project's team, creating the default agents the first time, and moving an old session to the lead. */
  private ensureProject(): void {
    const projectDir = this.options.projectDir();
    if (!projectDir) throw new Error("Open a project first.");
    if (projectDir !== this.project) {
      if (this.project) {
        // Another project: its own team and board.
        void this.stopAll();
        this.tasks = [];
      }
      const created = ensureDefaultAgents(projectDir);
      if (created.length) this.log.info("default agents created", { agents: created.join(", ") });
      this.project = projectDir;
    }
    this.refreshRoster();
    migrateSessionToLead(projectDir, this.lead);
  }

  /** Reads the definitions again, so an edited or added agent applies from its next task. */
  private refreshRoster(): void {
    const projectDir = this.options.projectDir();
    // Until the first request writes the default team, the project has it as it will be.
    const roster = projectDir ? readRoster(projectDir) : [];
    const members = projectDir && roster.length === 0 ? defaultRoster() : roster;
    const changed = JSON.stringify(members) !== JSON.stringify(this.members);
    this.members = members;
    // Created, added or edited (here or in the files): pages show the team as it is now.
    if (changed) {
      this.broadcast(this.definitions());
      this.publish();
    }
  }

  /** What an agent's process depends on: its definition, and for the lead the team it is told about. */
  private fingerprint(name: string): string {
    const member = this.member(name);
    return JSON.stringify([member ?? null, name === this.lead ? rosterText(this.members) : ""]);
  }

  private async restartIfChanged(name: string): Promise<void> {
    const started = this.startedWith.get(name);
    if (started !== undefined && started !== this.fingerprint(name)) {
      this.startedWith.delete(name);
      await this.hub(name).restart();
    }
  }

  /** The provider, detected once for the whole team (the lead checks; the others reuse its answer). */
  private providerFor(name: string): AgentProvider {
    const { provider } = this.options;
    const detects = name === DEFAULT_LEAD && this.hubs.size === 0;
    // Delegating, not spreading: a provider is usually a class instance, whose methods a spread would drop.
    return {
      id: provider.id,
      label: provider.label,
      start: (options) => provider.start(options),
      ...(provider.extensions ? { extensions: provider.extensions } : {}),
      detect: detects
        ? async () => {
            this.lastDetection = await provider.detect();
            return this.lastDetection;
          }
        : async () => this.lastDetection ?? provider.detect(),
    };
  }

  private hooksFor(name: string): TurnHooks {
    return {
      started: () => {
        const task = this.activeTask.get(name);
        if (task && this.member(name)?.writes) {
          this.options.scene.beginTurn(`${displayName(name)}: ${task.title}`);
          this.groupOwner = name;
        }
      },
      stopping: () => {
        this.options.approvals.denyAll("The user stopped the request.", name);
        this.options.panels?.turnEnded(name);
      },
      ended: () => {
        this.options.approvals.denyAll("The request ended before the user answered.", name);
        this.options.panels?.turnEnded(name);
        if (this.groupOwner === name) {
          this.groupOwner = null;
          this.options.scene.endTurn();
        }
      },
      initialized: (event) => this.options.initialized?.(event),
    };
  }

  /** Follows a specialist's turn for the board: its turn id and latest activity. */
  private observe(name: string, message: Message): void {
    const task = this.activeTask.get(name);
    if (!task) return;
    if (message.type === "agent.turn" && message.payload.taskId === task.id) {
      task.turnId = message.payload.id;
      this.publish();
    }
    if (message.type !== "agent.event") return;
    const { event } = message.payload;
    if (event.type === "tool.start") {
      task.lastActivity = `Using ${event.name.replace(/^mcp__[^_]+__/, "")}`;
      this.publish();
    } else if (event.type === "text.delta") {
      const reply = (this.replies.get(task.id) ?? "") + event.text;
      this.replies.set(task.id, reply);
      const line = reply.trim().split("\n").at(-1)?.trim();
      if (line) task.lastActivity = shorten(line, 120);
      this.publishSoon();
    }
  }

  /** Starts the queued tasks the limits allow, oldest first. */
  private schedule(): void {
    const active = this.tasks.filter((t) => ACTIVE.has(t.status));
    for (const task of this.tasks.filter((t) => t.status === "queued")) {
      if (active.length >= this.maxRunning) break;
      if (active.some((t) => t.agent === task.agent)) continue; // one task per agent at a time
      const writes = this.member(task.agent)?.writes ?? true;
      if (writes && active.some((t) => this.member(t.agent)?.writes ?? true)) continue; // one writer
      active.push(task);
      void this.run(task);
    }
  }

  private async run(task: TeamTask): Promise<void> {
    task.status = "running";
    task.startedAt = Date.now();
    this.activeTask.set(task.agent, task);
    this.publish();
    let outcome: TeamTask["status"] = "failed";
    let summary: string | undefined;
    try {
      this.refreshRoster();
      await this.restartIfChanged(task.agent);
      const turn = await this.hub(task.agent).request(task.instruction, undefined, {
        kind: "task",
        taskId: task.id,
        preface: `[task] "${task.title}", from ${displayName(this.lead)}`,
      });
      const end = turn.events.findLast((e) => e.type === "turn.end");
      const error = turn.events.findLast((e) => e.type === "error");
      const reason = end?.type === "turn.end" ? end.reason : undefined;
      outcome = reason === "done" || reason === "stopped" ? reason : "failed";
      summary = replyOf(turn.events) || (error?.type === "error" ? error.message : undefined);
    } catch (error) {
      summary = (error as Error).message;
    }
    if (this.stopping.has(task.id)) outcome = "stopped";
    this.activeTask.delete(task.agent);
    this.finish(task, outcome, summary);
    this.pumpNotes(task.agent);
  }

  /** Tells an agent what became of the panels it opened, once it has no turn running. */
  private pumpNotes(name: string): void {
    const hub = this.hub(name);
    if (this.activeTask.has(name) || hub.runningTurn || hub.currentStatus.state === "unavailable") return;
    const notes = this.panelNotes.get(name)?.splice(0);
    if (!notes?.length) return;
    const run = hub
      .request(notes.join("\n"), undefined, { kind: "digest" })
      .catch((error: Error) => this.log.info("panel note not delivered", { reason: error.message }))
      .finally(() => {
        this.noteRuns.delete(run);
        this.pumpNotes(name);
        this.resolveSettled();
      });
    this.noteRuns.add(run);
  }

  private finish(task: TeamTask, status: TeamTask["status"], summary?: string): void {
    task.status = status;
    task.finishedAt = Date.now();
    delete task.lastActivity;
    if (summary) task.summary = shorten(summary, TEAM.summaryChars);
    this.replies.delete(task.id);
    this.stopping.delete(task.id);
    this.log.info("task finished", {
      agent: task.agent,
      status,
      durationMs: task.finishedAt - (task.startedAt ?? task.finishedAt),
    });
    const finished = this.tasks.filter((t) => FINISHED.has(t.status));
    if (finished.length > TEAM.finishedKept) {
      const drop = new Set(finished.slice(0, finished.length - TEAM.finishedKept));
      this.tasks = this.tasks.filter((t) => !drop.has(t));
    }
    this.schedule();
    this.checkBatches();
    this.pumpDigests();
    this.publish();
  }

  /** Queues a report for each of Mochi's finished turns whose hand-offs have all finished. */
  private checkBatches(): void {
    const running = this.hub(this.lead).runningTurn?.id;
    const turns = new Set(this.tasks.flatMap((t) => (t.fromTurn ? [t.fromTurn] : [])));
    for (const turn of turns) {
      if (turn === running || this.reported.has(turn)) continue;
      const batch = this.tasks.filter((t) => t.fromTurn === turn);
      if (!batch.every((t) => FINISHED.has(t.status))) continue;
      this.reported.add(turn);
      this.digests.push(batch.map((t) => ({ ...t })));
    }
  }

  /** Sends Mochi the next report when it is free (never in the middle of the user's own turn). */
  private pumpDigests(): void {
    const lead = this.hub(this.lead);
    if (lead.runningTurn || lead.currentStatus.state === "unavailable") {
      this.resolveSettled();
      return;
    }
    const batch = this.digests.shift();
    if (!batch) {
      this.resolveSettled();
      return;
    }
    this.digestRunning = lead
      .request(digestText(batch), undefined, { kind: "digest" })
      .catch((error: Error) => this.log.info("team report not delivered", { reason: error.message }))
      .finally(() => {
        this.digestRunning = null;
        this.checkBatches();
        this.pumpDigests();
      });
  }

  private isSettled(): boolean {
    return (
      this.digests.length === 0 &&
      !this.digestRunning &&
      this.noteRuns.size === 0 &&
      !this.hub(this.lead).runningTurn &&
      this.tasks.every((t) => FINISHED.has(t.status))
    );
  }

  private resolveSettled(): void {
    if (!this.isSettled()) return;
    for (const resolve of this.settledWaiters.splice(0)) resolve();
  }

  /**
   * Adds or changes an agent (the Agents tab). It applies from the agent's next task: its process restarts then, with
   * the new definition, and Mochi's roster follows.
   */
  saveAgent(agent: AgentDefinitionInput): void {
    this.ensureProject();
    const projectDir = this.project as string;
    const existing = this.member(agent.name);
    if (existing?.lead && !agent.tools.includes(`mcp__${HAI_SERVER}__delegate`))
      throw new Error(`${displayName(agent.name)} leads the team: keep its delegate tool.`);
    saveDefinition(projectDir, agent);
    this.refreshRoster();
    this.log.info("agent saved", { agent: agent.name, added: !existing });
    this.broadcast(this.definitions(agent.name));
    this.publish();
  }

  private definitions(saved?: string): Message {
    return {
      type: "agents.snapshot",
      id: randomUUID(),
      payload: { definitions: this.members.map((m) => ({ ...m })), ...(saved ? { saved } : {}) },
    };
  }

  private snapshot(): Message {
    return {
      type: "team.snapshot",
      id: randomUUID(),
      payload: { members: this.members.map(memberInfo), tasks: this.board, maxRunning: this.maxRunning },
    };
  }

  private publish(): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    this.broadcast(this.snapshot());
  }

  private publishSoon(): void {
    this.snapshotTimer ??= setTimeout(() => this.publish(), TEAM.activityThrottleMs);
  }
}
