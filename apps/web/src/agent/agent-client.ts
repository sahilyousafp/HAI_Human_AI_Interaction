import type {
  AgentDefinition,
  AgentDefinitionInput,
  AgentEvent,
  AgentStatus,
  AgentTurn,
  ApprovalOutcome,
  ApprovalRequest,
  ExtensionsState,
  McpServerSpec,
  Message,
  RequestContext,
  TeamMemberInfo,
  TeamTask,
} from "@hai/protocol";
import { addressOf } from "./addressing.ts";

export type ToolOutcome = "running" | "done" | "failed" | "denied";

/** One piece of a turn, in the order it happened: reply text, a tool call, or an error. */
export type TurnItem =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      server?: string;
      input: unknown;
      outcome: ToolOutcome;
      summary?: string;
    }
  | { kind: "error"; message: string };

export interface TurnView {
  id: string;
  request: string;
  /** What a spoken request referred to. */
  context?: RequestContext;
  recovered: boolean;
  /** The user's request, a specialist's task (`taskId`), or Mochi's report of finished tasks. */
  kind: AgentTurn["kind"];
  taskId?: string;
  items: TurnItem[];
  /** How the turn ended; unset while it runs. */
  ended?: "done" | "stopped" | "error";
}

/** One agent's session: where it stands and its conversation. */
export interface AgentThread {
  status: AgentStatus | null;
  turns: TurnView[];
}

/** The team and its task board, as the bridge last reported them. */
export interface TeamView {
  members: TeamMemberInfo[];
  tasks: TeamTask[];
  maxRunning: number;
}

/** A `.3dm` file a Python run left in the project, offered for import into the viewer or to open in Rhino. */
export interface WrittenFile {
  /** Relative to the project folder. */
  path: string;
  size: number;
  /** The kept script that wrote it. */
  script: string;
  /** The agent that ran it. */
  agent?: string;
}

export interface ApprovalView {
  request: ApprovalRequest;
  /** The turn that was running when the card arrived. */
  turnId: string | null;
  /** Unset while the card waits for the user. */
  outcome?: ApprovalOutcome;
}

export interface AgentState {
  /** The lead's (Mochi's) session: null until the bridge has said where it stands. */
  status: AgentStatus | null;
  /** The lead's conversation: the chat. */
  turns: TurnView[];
  /** The specialists' sessions, by agent name. */
  specialists: Record<string, AgentThread>;
  /** Null until the bridge has sent the team. */
  team: TeamView | null;
  approvals: ApprovalView[];
  /** Tools the user chose "Always allow" for in the open project. */
  alwaysAllowed: string[];
  /** Files the agent's Python wrote, until the user imports, opens or dismisses them. */
  written: WrittenFile[];
  /** The last request the bridge refused (shown under the input). */
  error: string | null;
  /** Counts requests to show the panel (a voice request starting): it opens on the chat when this changes. */
  openTick: number;
  /** MCP servers and skills: loaded in the session, and configured in the project. Null until the bridge says. */
  extensions: ExtensionsState | null;
  /** An extension change is being applied. */
  extensionsBusy: boolean;
  /** The result of the last extension change: what is now active, or why it failed. */
  extensionsResult: { ok: boolean; message: string } | null;
  /** The project's agent definitions (Agents tab); null until the bridge has sent them. */
  agents: AgentDefinition[] | null;
  /** An agent is being saved. */
  agentsBusy: boolean;
  /** The result of the last save. */
  agentsResult: { ok: boolean; message: string } | null;
}

const INITIAL: AgentState = {
  status: null,
  turns: [],
  specialists: {},
  team: null,
  approvals: [],
  alwaysAllowed: [],
  written: [],
  error: null,
  openTick: 0,
  extensions: null,
  extensionsBusy: false,
  extensionsResult: null,
  agents: null,
  agentsBusy: false,
  agentsResult: null,
};

/** A turn's events folded into display items: consecutive text joins up, a tool's end updates its chip. */
export function foldEvents(items: TurnItem[], event: AgentEvent): TurnItem[] {
  switch (event.type) {
    case "text.delta": {
      const last = items.at(-1);
      if (last?.kind === "text")
        return [...items.slice(0, -1), { kind: "text", text: last.text + event.text }];
      return [...items, { kind: "text", text: event.text }];
    }
    case "tool.start":
      return [
        ...items,
        {
          kind: "tool",
          id: event.id,
          name: event.name,
          ...(event.server ? { server: event.server } : {}),
          input: event.input,
          outcome: "running",
        },
      ];
    case "tool.end":
      return items.map((item) =>
        item.kind === "tool" && item.id === event.id
          ? { ...item, outcome: event.outcome, summary: event.summary }
          : item,
      );
    case "error":
      return [...items, { kind: "error", message: event.message }];
    default:
      return items;
  }
}

function turnView(turn: AgentTurn): TurnView {
  let view: TurnView = {
    id: turn.id,
    request: turn.request,
    ...(turn.context ? { context: turn.context } : {}),
    recovered: turn.recovered,
    kind: turn.kind,
    ...(turn.taskId ? { taskId: turn.taskId } : {}),
    items: [],
  };
  for (const event of turn.events) view = withEvent(view, event);
  return view;
}

function withEvent(turn: TurnView, event: AgentEvent): TurnView {
  if (event.type === "turn.end") return { ...turn, ended: event.reason };
  return { ...turn, items: foldEvents(turn.items, event) };
}

const newId = () => crypto.randomUUID();

/** What the voice hears of Mochi: a reply event as it streams, or the user stopping the team. */
export type LeadReply = { turnId: string; event: AgentEvent } | { stopped: true };

/** The lead's name before the bridge has sent the team. */
const DEFAULT_LEAD = "mochi";
const ACTIVE_TASK: ReadonlySet<TeamTask["status"]> = new Set(["running", "waiting", "queued"]);

/** How an agent's name is shown: "architect" becomes "Architect". */
export const displayName = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** The id of the turn still running in a conversation, if any. */
const runningTurn = (turns: TurnView[]) => turns.findLast((t) => !t.ended)?.id ?? null;

/**
 * The browser's view of the user's agent session: the transcript, approval cards and status as the bridge reports
 * them, and the requests, stops and decisions the user makes (by typing, clicking, nodding or shaking).
 */
export class AgentClient {
  private state = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly replyListeners = new Set<(reply: LeadReply) => void>();
  /** Requests this page sent, by what they were for, so a refusal shows in the right place. */
  private readonly sentRequests = new Map<string, "chat" | "extensions" | "agents">();

  constructor(private readonly send: (message: Message) => boolean) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AgentState => this.state;

  /** Mochi's replies and reports as they stream in, and the user stopping the team (for the spoken voice). */
  onLeadReply = (listener: (reply: LeadReply) => void): (() => void) => {
    this.replyListeners.add(listener);
    return () => this.replyListeners.delete(listener);
  };

  /** Cards waiting for the user. */
  get pending(): ApprovalView[] {
    return this.state.approvals.filter((a) => !a.outcome);
  }

  /** The lead's name: the team's lead, or Mochi. */
  get lead(): string {
    return this.state.team?.members.find((m) => m.lead)?.name ?? DEFAULT_LEAD;
  }

  /** Whether anything is working: the lead's turn, or a specialist's task (running or queued). */
  get busy(): boolean {
    return (
      this.state.status?.state === "working" ||
      (this.state.team?.tasks.some((t) => ACTIVE_TASK.has(t.status)) ?? false)
    );
  }

  /** The id of the turn an agent is running now (the lead's when no agent is named), if any. */
  runningTurnId(agent?: string): string | null {
    return runningTurn(this.threadOf(agent).turns);
  }

  /** One agent's conversation (the lead's is the chat). */
  thread(agent: string): AgentThread {
    if (agent === this.lead) return { status: this.state.status, turns: this.state.turns };
    return this.state.specialists[agent] ?? { status: null, turns: [] };
  }

  /** Handles a bridge message; returns false if it was not about the agent. */
  handle(message: Message): boolean {
    switch (message.type) {
      case "agent.transcript": {
        const { turns, status, pending, agent } = message.payload;
        const views = turns.map(turnView);
        const running = runningTurn(views);
        const cards = pending.map((request) => ({ request, turnId: running }));
        if (this.isLead(agent)) {
          // The lead's transcript comes first on connect: it starts the page's cards afresh.
          this.update({ status, turns: views, approvals: cards });
        } else {
          const known = new Set(this.state.approvals.map((a) => a.request.id));
          this.updateThread(agent, { status, turns: views });
          this.update({
            approvals: [...this.state.approvals, ...cards.filter((c) => !known.has(c.request.id))],
          });
        }
        return true;
      }
      case "agent.status":
        this.updateThread(message.payload.agent, { status: message.payload.status });
        return true;
      case "agent.turn": {
        const { id, request, context, recovered, kind, taskId, agent } = message.payload;
        const turn: TurnView = {
          id,
          request,
          ...(context ? { context } : {}),
          recovered,
          kind,
          ...(taskId ? { taskId } : {}),
          items: [],
        };
        this.updateThread(agent, { turns: [...this.threadOf(agent).turns, turn] });
        if (this.isLead(agent) && kind === "request") this.update({ error: null });
        return true;
      }
      case "agent.event": {
        const { turnId, event, agent } = message.payload;
        const turns = this.threadOf(agent).turns.map((t) => (t.id === turnId ? withEvent(t, event) : t));
        this.updateThread(agent, { turns });
        // Mochi's replies to the user and its reports are spoken; a specialist's work is not.
        const turn = turns.find((t) => t.id === turnId);
        if (this.isLead(agent) && turn && turn.kind !== "task")
          for (const listener of this.replyListeners) listener({ turnId, event });
        return true;
      }
      case "agents.snapshot": {
        const { definitions, saved } = message.payload;
        if (!saved) {
          this.update({ agents: definitions });
          return true;
        }
        const notice = `Saved ${displayName(saved)}. It applies from its next task.`;
        this.update({ agents: definitions, agentsBusy: false, agentsResult: { ok: true, message: notice } });
        return true;
      }
      case "team.snapshot":
        this.update({ team: message.payload });
        return true;
      case "approval.pending": {
        const running = runningTurn(this.threadOf(message.payload.agent).turns);
        this.update({ approvals: [...this.state.approvals, { request: message.payload, turnId: running }] });
        return true;
      }
      case "approval.resolved": {
        const { id, outcome } = message.payload;
        this.update({
          approvals: this.state.approvals.map((a) => (a.request.id === id ? { ...a, outcome } : a)),
        });
        return true;
      }
      case "python.written": {
        const { files, script, agent } = message.payload;
        const fresh = files.map((f) => ({ ...f, script, ...(agent ? { agent } : {}) }));
        const paths = new Set(fresh.map((f) => f.path));
        // A file written again replaces its earlier offer.
        this.update({ written: [...this.state.written.filter((w) => !paths.has(w.path)), ...fresh] });
        return true;
      }
      case "approvals.allowed":
        this.update({ alwaysAllowed: message.payload.tools });
        return true;
      case "extensions.snapshot": {
        const { notice, ...extensions } = message.payload;
        this.update(
          notice
            ? { extensions, extensionsBusy: false, extensionsResult: { ok: true, message: notice } }
            : { extensions },
        );
        return true;
      }
      case "request.error": {
        const kind = this.sentRequests.get(message.payload.requestId);
        if (!kind) return false;
        this.sentRequests.delete(message.payload.requestId);
        if (kind === "chat") this.update({ error: message.payload.message });
        else if (kind === "agents")
          this.update({ agentsBusy: false, agentsResult: { ok: false, message: message.payload.message } });
        else
          this.update({
            extensionsBusy: false,
            extensionsResult: { ok: false, message: message.payload.message },
          });
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Sends a request, typed or spoken (with what it refers to, and the specialist the user named); false if the
   * bridge is not connected.
   */
  request(text: string, context?: RequestContext, agent?: string): boolean {
    const id = newId();
    this.sentRequests.set(id, "chat");
    this.update({ error: null });
    return this.send({
      type: "agent.send",
      id,
      payload: { text, ...(context ? { context } : {}), ...(agent ? { agent } : {}) },
    });
  }

  /**
   * Sends what the user typed or said, addressed by name: "Architect, add a stair core" goes to Mochi without the
   * name, for Architect. A request that names nobody, or only Mochi, is Mochi's to route.
   */
  ask(text: string, context?: RequestContext): boolean {
    const members = this.state.team?.members ?? [{ name: this.lead, aliases: [] }];
    const { agent, text: rest } = addressOf(text, members);
    const target = agent && agent !== this.lead ? agent : undefined;
    return this.request(rest || text.trim(), context, target);
  }

  /** Adds or changes an agent of the team (writes its definition in the project). */
  saveAgent(agent: AgentDefinitionInput): boolean {
    const message: Message = { type: "agents.save", id: newId(), payload: { agent } };
    if (!this.send(message)) {
      this.update({
        agentsResult: { ok: false, message: "The bridge is offline. Try again when it is back." },
      });
      return false;
    }
    this.sentRequests.set(message.id, "agents");
    this.update({ agentsBusy: true, agentsResult: null });
    return true;
  }

  addServer(server: McpServerSpec): boolean {
    return this.changeExtensions({ type: "extensions.addServer", id: newId(), payload: { server } });
  }

  removeServer(name: string): boolean {
    return this.changeExtensions({ type: "extensions.removeServer", id: newId(), payload: { name } });
  }

  /** From a local folder or an https git repository URL. */
  installSkill(source: string): boolean {
    return this.changeExtensions({ type: "extensions.installSkill", id: newId(), payload: { source } });
  }

  removeSkill(name: string): boolean {
    return this.changeExtensions({ type: "extensions.removeSkill", id: newId(), payload: { name } });
  }

  private changeExtensions(message: Message): boolean {
    if (!this.send(message)) {
      this.update({
        extensionsResult: { ok: false, message: "The bridge is offline. Try again when it is back." },
      });
      return false;
    }
    this.sentRequests.set(message.id, "extensions");
    this.update({ extensionsBusy: true, extensionsResult: null });
    return true;
  }

  /** Shows the panel on the chat (a voice request is starting), without moving the keyboard focus. */
  requestOpen(): void {
    this.update({ openTick: this.state.openTick + 1 });
  }

  /** Stops everything the team is doing (and Mochi stops talking). */
  stop(): void {
    for (const listener of this.replyListeners) listener({ stopped: true });
    this.send({ type: "agent.stop", id: newId(), payload: {} });
  }

  /** Stops one specialist's task, or takes it off the queue. */
  stopTask(taskId: string): void {
    this.send({ type: "task.stop", id: newId(), payload: { id: taskId } });
  }

  decide(approvalId: string, decision: "allow" | "deny" | "always"): void {
    this.send({ type: "approval.decide", id: newId(), payload: { id: approvalId, decision } });
  }

  /** Takes a written file off the list (it was imported, opened or dismissed). */
  dismissWritten(path: string): void {
    this.update({ written: this.state.written.filter((w) => w.path !== path) });
  }

  revoke(tool: string): void {
    this.send({ type: "approvals.revoke", id: newId(), payload: { tool } });
  }

  /**
   * A gesture's "yes" or "no" (a nod and a shake by default) for the only waiting card. Allowing needs the user to
   * be engaged, so a stray nod never allows anything. Returns whether there was exactly one card to answer.
   */
  answer(yes: boolean, engaged: boolean): boolean {
    const [only, ...more] = this.pending;
    if (!only || more.length > 0 || (yes && !engaged)) return false;
    this.decide(only.request.id, yes ? "allow" : "deny");
    return true;
  }

  /** Stops everything, if anything works (both fists, then open hands, by default). */
  stopRunning(): void {
    if (this.busy) this.stop();
  }

  /** Messages without an agent name come from a bridge without a team: they are the lead's. */
  private isLead(agent: string | undefined): boolean {
    return agent === undefined || agent === this.lead;
  }

  private threadOf(agent: string | undefined): AgentThread {
    return this.thread(agent ?? this.lead);
  }

  private updateThread(agent: string | undefined, partial: Partial<AgentThread>): void {
    if (agent === undefined || this.isLead(agent)) {
      this.update(partial);
      return;
    }
    this.update({
      specialists: { ...this.state.specialists, [agent]: { ...this.thread(agent), ...partial } },
    });
  }

  private update(partial: Partial<AgentState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }
}
