import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { AgentProvider, Detection } from "@hai/agent-core";
import type {
  AgentDefinitionInput,
  AgentEvent,
  AgentStatus,
  AgentTurn,
  ApprovalRequest,
  Message,
  RequestContext,
  SceneDocument,
  SceneOp,
  TaskScope,
  TeamClaim,
  TeamTask,
} from "@hai/protocol";
import { elementsInScope, scopeWithin } from "@hai/scene";
import { type Logger, silentLogger } from "../log.ts";
import type { AgentTokens } from "../mcp/agent-tokens.ts";
import type { ClaimTools, TeamTools, WorkerTools } from "../mcp/scene-tools.ts";
import { agentDir, HAI_SERVER, migrateSessionToLead } from "./agent-config.ts";
import type { AgentEyes } from "./agent-eyes.ts";
import { AgentHub, type TurnHooks } from "./agent-hub.ts";
import { ClaimTable, describeScope } from "./claims.ts";
import { reservedTagRefusal, stampOps } from "./ownership.ts";
import type { PanelClosure } from "./panels.ts";
import {
  allowedHaiTools,
  defaultRoster,
  ensureDefaultAgents,
  helperDefinitions,
  managedDefinition,
  memberInfo,
  readRoster,
  rosterText,
  saveDefinition,
  type TeamMember,
  workerDefinition,
  workerHaiTools,
} from "./roster.ts";

type Send = (message: Message) => void;

/** The team's limits; docs/agents.md documents each, and a test keeps them in step. */
export const TEAM = {
  /** How many specialists work at the same time, unless set otherwise. Mochi is always available on top. */
  maxRunning: 3,
  /** How many agent sessions (Mochi, the running specialists and their workers) run at once, unless the user set otherwise. */
  maxSessions: 6,
  /** How long a stopped task's workers have to end before they are ended for it, in milliseconds. */
  workerStopMs: 3000,
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
export const displayName = (name: string) => {
  const spoken = name.replace(".", " ");
  return spoken.charAt(0).toUpperCase() + spoken.slice(1);
};

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
  const who = closure.by === "user" ? "The user closed" : "The app closed";
  if (closure.readOnly) {
    const refused = closure.refused
      ? " It tried to change the model, which an information panel cannot do: nothing was changed."
      : "";
    return `[panel] ${who} your information panel "${closure.title}"; the model is unchanged.${refused} Reply in chat if it helps, and do not reopen it unless asked.`;
  }
  const outcome =
    closure.outcome === "kept"
      ? "kept the result: it is in the model as one undo step"
      : "discarded the result: the model is as it was";
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
  scene: { beginTurn(agent: string, label: string): void; endTurn(agent: string): void };
  approvals: { readonly waiting: ApprovalRequest[]; denyAll(message: string, agent?: string): void };
  /** Generated panels: an agent's turn ended or was stopped, so an offer it left unanswered is over. */
  panels?: { turnEnded(agent: string): void };
  /** An agent session reported what it loaded (servers, tools, skills). */
  initialized?(event: Extract<AgentEvent, { type: "init" }>): void;
  idleMs?: number;
  maxRunning?: number;
  /** How many sessions may run at once (the user's setting, read each time). */
  maxSessions?(): number;
  /** The claims of the running tasks; the scene tools check changes against the same table. */
  claims?: ClaimTable;
  /** The scene, to resolve element ids and parts when claims are compared. */
  doc?(): SceneDocument;
  /** Whether Parallel modelling is on: writers with scopes that do not overlap work at the same time. */
  parallel?(): boolean;
  /** The agents' own cameras and last pictures: on the snapshot, and gone with the task that placed them. */
  eyes?: Pick<AgentEyes, "snapshot" | "clear">;
  log?: Logger;
}

/**
 * The project's agent team, as the bridge runs it: one session per agent (`AgentHub`), Mochi taking every request,
 * and the task board with its scheduler for the work Mochi hands to the specialists.
 *
 * - Up to `maxRunning` specialists work at once, each on one task at a time; later tasks queue.
 * - Agents that change the model work at the same time only when their tasks' scopes do not overlap (a task with no
 *   scope overlaps everything), and with Parallel modelling off only one does. Each writing task is one undo step,
 *   labelled "<Agent>: <title>". Agents that only read run alongside.
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
  /** The agents whose writing turn has an open undo group in the scene. */
  private readonly openGroups = new Set<string>();
  /** Which part of the model each running writing task may change. */
  readonly claims: ClaimTable;
  /** The shared brief of the tasks one of Mochi's turns handed out. */
  private readonly briefs = new Map<string, string>();
  /** A worker's name, and the specialist it was started from (its definition, tools and colour are that agent's). */
  private readonly workerBase = new Map<string, string>();
  /** How many workers each specialist has started, so a name is never used twice. */
  private readonly workerCounts = new Map<string, number>();
  /** What a specialist is to be told about its workers that ended, by the parent's task id. */
  private readonly workerNotes = new Map<string, string[]>();
  /** A parent task waiting for its workers, woken when one ends. */
  private readonly workerWaiters = new Map<string, () => void>();
  /** Who waits for a task to end. */
  private readonly endWaiters = new Map<string, Array<() => void>>();
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
    this.claims = options.claims ?? new ClaimTable();
    this.ready = this.hub(DEFAULT_LEAD).ready;
  }

  get maxRunning(): number {
    return this.options.maxRunning ?? TEAM.maxRunning;
  }

  /** How many agent sessions may run at once. */
  get maxSessions(): number {
    return this.options.maxSessions?.() ?? TEAM.maxSessions;
  }

  /** The sessions running now: Mochi, every specialist with a task and every worker. */
  get sessions(): number {
    return 1 + this.tasks.filter((t) => ACTIVE.has(t.status)).length;
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
          const base = this.workerBase.has(name) ? this.memberOf(name) : undefined;
          return {
            url: this.options.mcpUrl(),
            token: this.options.tokens.issue({
              agent: name,
              tools: base ? workerHaiTools(base) : member ? allowedHaiTools(member) : new Set<string>(),
            }),
          };
        },
        extraPrompt: () => (name === this.lead ? rosterText(this.members) : undefined),
        definition: () => {
          const base = this.workerBase.has(name) ? this.memberOf(name) : undefined;
          if (base) return workerDefinition(base);
          const member = this.member(name);
          return member ? managedDefinition(member) : undefined;
        },
        helpers: () => {
          const base = this.memberOf(name);
          return base ? helperDefinitions(base, this.members) : undefined;
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

  /** A specialist's tool for starting a worker on a part of its own task. */
  readonly workerTools: WorkerTools = {
    spawn: (agent, input) => this.spawnWorker(agent, input),
  };

  /** The lead's tools on the MCP endpoint. */
  readonly tools: TeamTools = {
    has: (name) => this.member(name) !== undefined && !this.member(name)?.lead,
    delegate: (task) => this.delegate(task),
    status: () => this.status(),
    cancel: (taskId) => this.cancel(taskId),
  };

  /**
   * Checks an agent's change to the model and puts its name on it. The agent's own tags may not use the system's
   * names; what it creates is stamped with its name (and its task's part); and, with Parallel modelling on, the whole
   * batch is refused unless it lies inside the agent's claim and clear of everyone else's.
   */
  vet(agent: string | null, ops: SceneOp[]): { ok: true; ops: SceneOp[] } | { ok: false; error: string } {
    const doc = this.options.doc?.();
    if (!agent || !doc) return { ok: true, ops };
    const refused = reservedTagRefusal(ops, doc);
    if (refused) return { ok: false, error: refused };
    const claim = this.claims.forAgent(agent);
    const stamped = stampOps(ops, doc, agent, claim?.scope?.part);
    if (!this.options.parallel?.()) return { ok: true, ops: stamped };
    if (!claim) {
      if (this.memberOf(agent) && agent !== this.lead) {
        return {
          ok: false,
          error:
            "You have no running task, so you cannot change the model now. Nothing was changed. If the user asked for something, say so in your reply.",
        };
      }
      const working = [...new Set(this.claims.all.map((c) => displayName(c.agent)))];
      if (working.length > 0) {
        return {
          ok: false,
          error: `${working.join(" and ")} ${working.length > 1 ? "are" : "is"} working on the model right now. Nothing was changed. Hand the work to a specialist with delegate instead.`,
        };
      }
      return { ok: true, ops: stamped };
    }
    const checked = this.claims.check(claim, stamped, doc);
    // What the claim holds changes as the agent adds elements: the panel's counts follow (throttled).
    if (checked.ok) this.publishSoon();
    return checked.ok ? { ok: true, ops: stamped } : checked;
  }

  /** The claim tools of the agents (see scene-tools.ts). */
  readonly claimTools: ClaimTools = {
    list: (agent) => this.listClaims(agent),
    request: (agent, scope) => this.requestClaim(agent, scope),
    release: (agent, release) => this.releaseClaim(agent, release),
    userChanges: (agent, ids) => {
      const claim = this.claims.forAgent(agent);
      return claim ? this.claims.takeUserChanges(claim.taskId, ids) : new Set<string>();
    },
  };

  private listClaims(agent: string): unknown {
    const doc = this.options.doc?.();
    const own = this.claims.forAgent(agent);
    const task = (id: string) => this.tasks.find((t) => t.id === id);
    const held = (scope: TaskScope | null) =>
      doc ? Object.values(doc.elements).filter((e) => this.claims.covers({ scope }, e, doc)).length : 0;
    const brief = (own && task(own.taskId)?.brief) || this.tasks.findLast((t) => t.brief)?.brief;
    return {
      ...(brief ? { brief } : {}),
      claims: this.claims.all.map((c) => ({
        agent: c.agent,
        task: c.title,
        scope: describeScope(c.scope),
        elements: held(c.scope),
        you: c.agent === agent,
      })),
      waiting: this.tasks
        .filter((t) => t.status === "queued" && t.waitingFor)
        .map((t) => {
          const blocker = task(t.waitingFor as string);
          return {
            agent: t.agent,
            task: t.title,
            waitsFor: blocker ? `${blocker.agent}'s task "${blocker.title}"` : "another task",
          };
        }),
    };
  }

  private requestClaim(
    agent: string,
    scope: TaskScope,
  ): { ok: true; scope: string } | { ok: false; error: string } {
    const doc = this.options.doc?.();
    const claim = this.claims.forAgent(agent);
    const task = claim ? this.tasks.find((t) => t.id === claim.taskId) : undefined;
    if (!claim || !task || !doc) return { ok: false, error: "You have no running task to add to." };
    if (!claim.scope) return { ok: false, error: "Your task already has the whole model." };
    if (scope.part !== undefined && claim.scope.part !== undefined && scope.part !== claim.scope.part)
      return {
        ok: false,
        error: `Your claim already has the part "${claim.scope.part}"; a claim has one part. Ask for ids or a region instead.`,
      };
    if (scope.region && claim.scope.region)
      return { ok: false, error: "Your claim already has a region; a claim has one. Ask for ids instead." };
    // A worker's claim is cut from its parent's: what it asks for must lie inside that, and the parent's own claim
    // is not in its way.
    const parentClaim = claim.parent ? this.claims.all.find((c) => c.taskId === claim.parent) : undefined;
    if (parentClaim) {
      const within = scopeWithin(scope, parentClaim.scope, doc);
      if (!within.ok) return { ok: false, error: `Not granted: ${within.reason}.` };
    }
    for (const other of this.claims.all) {
      if (other.taskId === claim.taskId || this.claims.isBelow(claim, other.taskId)) continue;
      if (!this.claims.overlap(scope, other.scope, doc)) continue;
      return {
        ok: false,
        error: `Not granted: ${describeScope(scope)} is claimed by ${other.agent}'s task "${other.title}" (${describeScope(other.scope)}). Leave it to them, or tell the user.`,
      };
    }
    const ids = [...new Set([...(claim.scope.ids ?? []), ...(scope.ids ?? [])])];
    const merged: TaskScope = {
      ...(ids.length ? { ids } : {}),
      ...((scope.part ?? claim.scope.part) !== undefined
        ? { part: (scope.part ?? claim.scope.part) as string }
        : {}),
      ...((scope.region ?? claim.scope.region)
        ? { region: (scope.region ?? claim.scope.region) as never }
        : {}),
    };
    this.claims.rescope(claim.taskId, merged);
    task.scope = merged;
    this.publish();
    return { ok: true, scope: describeScope(merged) };
  }

  private releaseClaim(
    agent: string,
    release: { ids?: string[] | undefined; part?: boolean | undefined; region?: boolean | undefined },
  ): { ok: true; scope: string } | { ok: false; error: string } {
    const claim = this.claims.forAgent(agent);
    const task = claim ? this.tasks.find((t) => t.id === claim.taskId) : undefined;
    if (!claim || !task) return { ok: false, error: "You have no running task." };
    if (!claim.scope)
      return { ok: false, error: "Your task has the whole model; there is nothing to give back." };
    let next: TaskScope | undefined = ClaimTable.withoutIds(claim.scope, release.ids ?? []);
    if (next && release.part) {
      const { part: _part, ...rest } = next;
      next = Object.keys(rest).length ? (rest as TaskScope) : undefined;
    }
    if (next && release.region) {
      const { region: _region, ...rest } = next;
      next = Object.keys(rest).length ? (rest as TaskScope) : undefined;
    }
    if (!next)
      return { ok: false, error: "That would leave your task with nothing. Finish the task instead." };
    this.claims.rescope(claim.taskId, next);
    task.scope = next;
    this.schedule();
    this.publish();
    return { ok: true, scope: describeScope(next) };
  }

  /** Hands a task to a specialist: queued at once, started when the scheduler allows. */
  delegate(task: {
    agent: string;
    title: string;
    instruction: string;
    scope?: TaskScope | undefined;
    brief?: string | undefined;
  }): { ok: true; taskId: string; status: string; note?: string } | { ok: false; error: string } {
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
    // One brief per request: the latest one Mochi gives applies to every task of the request, started or not.
    const brief = task.brief?.trim();
    if (brief && fromTurn) {
      this.briefs.set(fromTurn, brief);
      for (const other of this.tasks) if (other.fromTurn === fromTurn) other.brief = brief;
    }
    const shared = brief || (fromTurn ? this.briefs.get(fromTurn) : undefined);
    const record: TeamTask = {
      id: randomUUID(),
      agent,
      title: shorten(task.title.trim(), 80),
      instruction: task.instruction.trim(),
      status: "queued",
      createdAt: Date.now(),
      ...(fromTurn ? { fromTurn } : {}),
      ...(task.scope ? { scope: task.scope } : {}),
      ...(shared ? { brief: shared } : {}),
    };
    const note = member.writes ? this.overlapNote(record) : undefined;
    this.tasks.push(record);
    this.log.info("task handed out", { agent });
    this.schedule();
    this.publish();
    return { ok: true, taskId: record.id, status: record.status, ...(note ? { note } : {}) };
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
            ...(current && this.children(current).some((w) => !FINISHED.has(w.status))
              ? {
                  workers: this.children(current)
                    .filter((w) => !FINISHED.has(w.status))
                    .map(brief),
                }
              : {}),
          };
        }),
      recentlyFinished: this.tasks
        .filter((t) => FINISHED.has(t.status) && t.kind !== "worker")
        .slice(-5)
        .map((t) => ({ ...brief(t), agent: t.agent, summary: t.summary ?? "" })),
    };
  }

  /** Stops a running task or takes a queued one off the queue. */
  cancel(taskId: string): { ok: true; status: string } | { ok: false; error: string } {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return { ok: false, error: `No task ${taskId}.` };
    if (FINISHED.has(task.status)) return { ok: true, status: task.status };
    // Stopping a task stops its workers.
    for (const worker of this.children(task)) if (!FINISHED.has(worker.status)) this.cancel(worker.id);
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

  /** The member whose definition an agent runs with: itself, or for a worker the specialist it was started from. */
  private memberOf(name: string): TeamMember | undefined {
    const base = this.workerBase.get(name);
    return base ? this.member(base) : this.member(name);
  }

  /** The workers a task has started (finished ones too, while they stay on the board). */
  private children(task: TeamTask): TeamTask[] {
    return this.tasks.filter((t) => t.parent === task.id);
  }

  /** Reads the open project's team, creating the default agents the first time, and moving an old session to the lead. */
  private ensureProject(): void {
    const projectDir = this.options.projectDir();
    if (!projectDir) throw new Error("Open a project first.");
    if (projectDir !== this.project) {
      if (this.project) {
        // Another project: its own team and board.
        void this.stopAll();
        for (const name of [...this.workerBase.keys()]) void this.retire(name);
        this.workerBase.clear();
        this.workerCounts.clear();
        this.workerNotes.clear();
        this.tasks = [];
        this.claims.clear();
        this.briefs.clear();
        this.options.eyes?.clear();
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
        // A task is one undo step: its note turns (a specialist hearing from its workers) go into the same group.
        if (task && this.memberOf(name)?.writes && !this.openGroups.has(name)) {
          this.options.scene.beginTurn(name, `${displayName(name)}: ${task.title}`);
          this.openGroups.add(name);
        }
      },
      stopping: () => {
        this.options.approvals.denyAll("The user stopped the request.", name);
        this.options.panels?.turnEnded(name);
      },
      ended: () => {
        this.options.approvals.denyAll("The request ended before the user answered.", name);
        this.options.panels?.turnEnded(name);
        // The task closes its own group when it ends; a turn of the task is not the end.
        if (!this.activeTask.has(name) && this.openGroups.delete(name)) this.options.scene.endTurn(name);
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
    const active = this.tasks.filter((t) => ACTIVE.has(t.status) && t.kind !== "worker");
    // Queued writers that could not start: a later task that overlaps one waits for it, so a task that needs the
    // whole model is not starved by smaller tasks that keep starting.
    const waiting: TeamTask[] = [];
    let changed = false;
    for (const task of this.tasks.filter((t) => t.status === "queued" && t.kind !== "worker")) {
      const blocker = this.writes(task) ? this.writerBlocking(task, active, waiting) : undefined;
      if (blocker?.id !== task.waitingFor) {
        if (blocker) task.waitingFor = blocker.id;
        else delete task.waitingFor;
        changed = true;
      }
      if (active.length >= this.maxRunning) continue;
      if (active.some((t) => t.agent === task.agent)) continue; // one task per agent at a time
      if (blocker) {
        waiting.push(task);
        continue;
      }
      if (this.sessions >= this.maxSessions) {
        changed = this.markWaitingForSession(task) || changed;
        continue;
      }
      delete task.waitingForSession;
      active.push(task);
      if (this.writes(task)) {
        this.claims.grant({
          taskId: task.id,
          agent: task.agent,
          title: task.title,
          scope: task.scope ?? null,
        });
      }
      void this.run(task);
    }
    if (this.startWorkers()) changed = true;
    if (changed) this.publishSoon();
  }

  /** A task or worker that waits for a free session rather than for a claim. Returns whether that is news. */
  private markWaitingForSession(task: TeamTask): boolean {
    if (task.waitingForSession) return false;
    task.waitingForSession = true;
    return true;
  }

  /**
   * Starts the queued workers the session limit allows, oldest first, each under a claim cut from its parent's. A
   * worker whose parent has ended is not started. Returns whether anything changed.
   */
  private startWorkers(): boolean {
    let changed = false;
    for (const worker of this.tasks.filter((t) => t.kind === "worker" && t.status === "queued")) {
      const parent = this.claims.all.find((c) => c.taskId === worker.parent);
      if (!parent) {
        this.finish(worker, "stopped", "Its task ended before it could start.");
        changed = true;
        continue;
      }
      if (this.sessions >= this.maxSessions) {
        changed = this.markWaitingForSession(worker) || changed;
        continue;
      }
      delete worker.waitingForSession;
      this.claims.grant({
        taskId: worker.id,
        agent: worker.agent,
        title: worker.title,
        scope: worker.scope ?? null,
        ...(worker.parent ? { parent: worker.parent } : {}),
      });
      void this.run(worker);
      changed = true;
    }
    return changed;
  }

  /**
   * Starts a worker for a part of the calling specialist's own task. The part lies inside the specialist's claim and
   * clear of its other workers; the worker is its own session, started from the specialist's definition under the name
   * `<agent>.<n>`, and its claim is cut from the specialist's, so the specialist leaves that part alone while it runs.
   */
  spawnWorker(
    agent: string,
    input: { title: string; instruction: string; scope: TaskScope },
  ):
    | { ok: true; worker: string; taskId: string; status: "running" | "queued"; note?: string }
    | { ok: false; error: string } {
    const refuse = (error: string) => ({ ok: false as const, error });
    if (this.workerBase.has(agent))
      return refuse(
        "Workers cannot start workers. Do your part yourself, and say in your summary if it needs splitting further.",
      );
    if (!this.options.parallel?.())
      return refuse(
        "Parallel modelling is off, so workers cannot be started. Do the work yourself, or ask the user to switch it on in Settings > Features.",
      );
    const member = this.member(agent);
    if (!member || member.lead || !member.writes)
      return refuse("Only a specialist that changes the model can start workers.");
    const doc = this.options.doc?.();
    const claim = this.claims.forAgent(agent);
    const parent = claim ? this.tasks.find((t) => t.id === claim.taskId) : undefined;
    if (!claim || !parent || !doc) return refuse("You have no running task, so you cannot start workers.");
    const within = scopeWithin(input.scope, claim.scope, doc);
    if (!within.ok) return refuse(`Not started: ${within.reason}. Nothing was started.`);
    for (const sibling of this.children(parent)) {
      if (FINISHED.has(sibling.status)) continue;
      if (this.claims.overlap(input.scope, sibling.scope ?? null, doc))
        return refuse(
          `Not started: ${describeScope(input.scope)} overlaps ${displayName(sibling.agent)}'s part "${sibling.title}" (${describeScope(sibling.scope ?? null)}). Give each worker its own part. Nothing was started.`,
        );
    }
    const n = (this.workerCounts.get(agent) ?? 1) + 1;
    this.workerCounts.set(agent, n);
    const name = `${agent}.${n}`;
    this.workerBase.set(name, agent);
    const record: TeamTask = {
      id: randomUUID(),
      agent: name,
      title: shorten(input.title.trim(), 80),
      instruction: input.instruction.trim(),
      status: "queued",
      createdAt: Date.now(),
      parent: parent.id,
      kind: "worker",
      scope: input.scope,
      ...(parent.brief ? { brief: parent.brief } : {}),
    };
    this.tasks.push(record);
    this.log.info("worker handed out", { agent: name });
    this.schedule();
    this.publish();
    const queued = record.status === "queued";
    return {
      ok: true,
      worker: name,
      taskId: record.id,
      status: queued ? "queued" : "running",
      ...(queued
        ? {
            note: `It waits for a free session (${this.sessions} of ${this.maxSessions} are running) and starts when one ends.`,
          }
        : {}),
    };
  }

  private writes(task: TeamTask): boolean {
    return this.memberOf(task.agent)?.writes ?? true;
  }

  /** The running or earlier-queued writing task this one has to wait for, if any. */
  private writerBlocking(task: TeamTask, active: TeamTask[], waiting: TeamTask[]): TeamTask | undefined {
    const writers = active.filter((t) => this.writes(t));
    if (!this.options.parallel?.()) return writers[0]; // one writer at a time
    const doc = this.options.doc?.();
    const overlaps = (other: TeamTask) =>
      !doc || this.claims.overlap(task.scope ?? null, other.scope ?? null, doc);
    return [...writers, ...waiting].find(overlaps);
  }

  /** Said to Mochi when a new task's scope overlaps another writing task's, so it can split better. */
  private overlapNote(task: TeamTask): string | undefined {
    const doc = this.options.doc?.();
    if (!this.options.parallel?.() || !doc) return undefined;
    const other = this.tasks.find(
      (t) =>
        !FINISHED.has(t.status) &&
        this.writes(t) &&
        this.claims.overlap(task.scope ?? null, t.scope ?? null, doc),
    );
    if (!other) return undefined;
    const why =
      !task.scope || !other.scope ? "a task without a scope takes the whole model" : "their scopes overlap";
    return `This task overlaps ${displayName(other.agent)}'s "${other.title}" (${why}), so it waits for it instead of running at the same time. Give each task its own part, ids or region to work in parallel.`;
  }

  private async run(task: TeamTask): Promise<void> {
    task.status = "running";
    task.startedAt = Date.now();
    this.activeTask.set(task.agent, task);
    this.log.info("session started", {
      agent: task.agent,
      kind: task.kind ?? "task",
      waitedMs: task.startedAt - task.createdAt,
      sessions: this.sessions,
      limit: this.maxSessions,
    });
    this.publish();
    let outcome: TeamTask["status"] = "failed";
    let summary: string | undefined;
    try {
      this.refreshRoster();
      await this.restartIfChanged(task.agent);
      const turn = await this.hub(task.agent).request(task.instruction, undefined, {
        kind: "task",
        taskId: task.id,
        preface: this.prefaceFor(task),
      });
      const end = turn.events.findLast((e) => e.type === "turn.end");
      const error = turn.events.findLast((e) => e.type === "error");
      const reason = end?.type === "turn.end" ? end.reason : undefined;
      outcome = reason === "done" || reason === "stopped" ? reason : "failed";
      summary = replyOf(turn.events) || (error?.type === "error" ? error.message : undefined);
      // A task ends after its workers have, and hears from each of them on the way.
      if (task.kind !== "worker") ({ outcome, summary } = await this.awaitWorkers(task, outcome, summary));
    } catch (error) {
      summary = (error as Error).message;
      await this.cancelWorkers(task);
    }
    if (this.stopping.has(task.id)) outcome = "stopped";
    this.activeTask.delete(task.agent);
    this.finish(task, outcome, summary);
    this.pumpNotes(task.agent);
  }

  /**
   * Keeps a specialist's task running until its workers have ended, giving it each worker's outcome and summary as a
   * turn so it can fix a part or report. A task that was stopped, or whose own turn failed, stops its workers instead.
   */
  private async awaitWorkers(
    task: TeamTask,
    first: TeamTask["status"],
    firstSummary: string | undefined,
  ): Promise<{ outcome: TeamTask["status"]; summary: string | undefined }> {
    const hub = this.hub(task.agent);
    let outcome = first;
    let summary = firstSummary;
    for (;;) {
      if (this.stopping.has(task.id) || outcome !== "done") {
        await this.cancelWorkers(task);
        return { outcome, summary };
      }
      const notes = this.workerNotes.get(task.id)?.splice(0) ?? [];
      if (notes.length > 0) {
        const turn = await hub.request(notes.join("\n"), undefined, { kind: "digest" });
        const end = turn.events.findLast((e) => e.type === "turn.end");
        const reason = end?.type === "turn.end" ? end.reason : undefined;
        outcome = reason === "done" || reason === "stopped" ? reason : "failed";
        summary = replyOf(turn.events) || summary;
        continue;
      }
      if (this.children(task).every((w) => FINISHED.has(w.status))) return { outcome, summary };
      await new Promise<void>((resolve) => this.workerWaiters.set(task.id, resolve));
    }
  }

  /** Stops a task's workers and waits for them to end, ending them itself after a few seconds. */
  private async cancelWorkers(task: TeamTask): Promise<void> {
    const open = this.children(task).filter((w) => !FINISHED.has(w.status));
    if (open.length === 0) return;
    for (const worker of open) this.cancel(worker.id);
    const ended = Promise.all(open.map((w) => this.ended(w)));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, TEAM.workerStopMs));
    await Promise.race([ended, timeout]);
    for (const worker of open) if (!FINISHED.has(worker.status)) this.finish(worker, "stopped");
  }

  /** Resolves when the task has ended. */
  private ended(task: TeamTask): Promise<void> {
    if (FINISHED.has(task.status)) return Promise.resolve();
    return new Promise((resolve) => {
      const waiting = this.endWaiters.get(task.id) ?? [];
      waiting.push(resolve);
      this.endWaiters.set(task.id, waiting);
    });
  }

  /** What a specialist is told at the start of a task: the title, the shared brief and the part it may change. */
  private prefaceFor(task: TeamTask): string {
    const parent = task.kind === "worker" ? this.tasks.find((t) => t.id === task.parent) : undefined;
    const lines = [
      parent
        ? `[worker] "${task.title}", a part of ${displayName(parent.agent)}'s task "${parent.title}". Do only this part, then end with a short summary of what you made. You cannot start workers.`
        : `[task] "${task.title}", from ${displayName(this.lead)}`,
    ];
    if (task.brief) lines.push(`[brief] ${task.brief}`);
    if (this.writes(task) && task.scope && this.options.parallel?.()) {
      lines.push(
        `[scope] You may change ${describeScope(task.scope)}; other agents work on the rest at the same time. A change outside it is refused. See get_claims, and request_claim to ask for more.`,
      );
    }
    return lines.join("\n");
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
    if (FINISHED.has(task.status)) return; // ended already (a stopped task's worker that was ended for it)
    task.status = status;
    task.finishedAt = Date.now();
    delete task.lastActivity;
    delete task.waitingFor;
    delete task.waitingForSession;
    // The task's undo step closes, then the claim goes before the scheduler runs, so the task waiting on it starts in
    // the same pass.
    if (this.openGroups.delete(task.agent)) this.options.scene.endTurn(task.agent);
    this.claims.release(task.id);
    this.options.eyes?.clear(task.agent);
    if (summary) task.summary = shorten(summary, TEAM.summaryChars);
    this.replies.delete(task.id);
    this.stopping.delete(task.id);
    this.log.info("session ended", {
      agent: task.agent,
      kind: task.kind ?? "task",
      status,
      durationMs: task.finishedAt - (task.startedAt ?? task.finishedAt),
    });
    for (const resolve of this.endWaiters.get(task.id) ?? []) resolve();
    this.endWaiters.delete(task.id);
    if (task.kind === "worker") this.workerEnded(task);
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

  /** A worker ended: its parent hears how (unless the parent is the one stopping), and its process is closed. */
  private workerEnded(worker: TeamTask): void {
    const parent = this.tasks.find((t) => t.id === worker.parent);
    if (parent && !FINISHED.has(parent.status) && !this.stopping.has(parent.id)) {
      const notes = this.workerNotes.get(parent.id) ?? [];
      notes.push(
        `[worker report] ${displayName(worker.agent)} "${worker.title}" ${worker.status}.${worker.summary ? ` ${worker.summary}` : ""}`,
      );
      this.workerNotes.set(parent.id, notes);
    }
    const wake = this.workerWaiters.get(worker.parent ?? "");
    this.workerWaiters.delete(worker.parent ?? "");
    wake?.();
    void this.retire(worker.agent);
  }

  /** Closes a worker's process, forgets its token and removes its files: it never comes back. */
  private async retire(name: string): Promise<void> {
    const hub = this.hubs.get(name);
    this.hubs.delete(name);
    this.options.tokens.revoke(name);
    try {
      await hub?.close();
    } catch (error) {
      this.log.info("worker did not close cleanly", { reason: (error as Error).message });
    }
    const projectDir = this.options.projectDir();
    if (projectDir) rmSync(agentDir(projectDir, name), { recursive: true, force: true });
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
      payload: {
        definitions: this.members.map(({ grants: _grants, ...m }) => m),
        ...(saved ? { saved } : {}),
      },
    };
  }

  private snapshot(): Message {
    return {
      type: "team.snapshot",
      id: randomUUID(),
      payload: {
        members: this.members.map(memberInfo),
        tasks: this.board,
        claims: this.claimsSnapshot(),
        maxRunning: this.maxRunning,
        maxSessions: this.maxSessions,
        sessions: this.sessions,
        ...(this.options.eyes?.snapshot() ?? { shots: [], cameras: [] }),
      },
    };
  }

  /** What each running writing task holds, with how many elements that is now. */
  private claimsSnapshot(): TeamClaim[] {
    const doc = this.options.doc?.();
    return this.claims.all.map((c) => ({
      taskId: c.taskId,
      agent: c.agent,
      title: c.title,
      scope: c.scope,
      elements: doc ? elementsInScope(c.scope, doc).length : 0,
      ...(c.parent ? { parent: c.parent } : {}),
    }));
  }

  private publish(): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    this.broadcast(this.snapshot());
  }

  /** The user changed the limit on sessions: queued tasks and workers may start now, and the strip shows it. */
  limitsChanged(): void {
    this.schedule();
    this.publish();
  }

  /** An agent placed or deleted a camera, or took a picture: the strip shows it. */
  eyesChanged(): void {
    this.publishSoon();
  }

  private publishSoon(): void {
    this.snapshotTimer ??= setTimeout(() => this.publish(), TEAM.activityThrottleMs);
  }
}
