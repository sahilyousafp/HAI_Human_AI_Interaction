import type {
  AgentEvent,
  AgentStatus,
  AgentTurn,
  ApprovalOutcome,
  ApprovalRequest,
  ExtensionsState,
  McpServerSpec,
  Message,
} from "@aex/protocol";

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
  recovered: boolean;
  items: TurnItem[];
  /** How the turn ended; unset while it runs. */
  ended?: "done" | "stopped" | "error";
}

export interface ApprovalView {
  request: ApprovalRequest;
  /** The turn that was running when the card arrived. */
  turnId: string | null;
  /** Unset while the card waits for the user. */
  outcome?: ApprovalOutcome;
}

export interface AgentState {
  /** Null until the bridge has said where the session stands. */
  status: AgentStatus | null;
  turns: TurnView[];
  approvals: ApprovalView[];
  /** Tools the user chose "Always allow" for in the open project. */
  alwaysAllowed: string[];
  /** The last request the bridge refused (shown under the input). */
  error: string | null;
  /** Counts "Ask agent" requests: the panel opens and focuses its input when it changes. */
  focusTick: number;
  /** MCP servers and skills: loaded in the session, and configured in the project. Null until the bridge says. */
  extensions: ExtensionsState | null;
  /** An extension change is being applied. */
  extensionsBusy: boolean;
  /** The result of the last extension change: what is now active, or why it failed. */
  extensionsResult: { ok: boolean; message: string } | null;
}

const INITIAL: AgentState = {
  status: null,
  turns: [],
  approvals: [],
  alwaysAllowed: [],
  error: null,
  focusTick: 0,
  extensions: null,
  extensionsBusy: false,
  extensionsResult: null,
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
  let view: TurnView = { id: turn.id, request: turn.request, recovered: turn.recovered, items: [] };
  for (const event of turn.events) view = withEvent(view, event);
  return view;
}

function withEvent(turn: TurnView, event: AgentEvent): TurnView {
  if (event.type === "turn.end") return { ...turn, ended: event.reason };
  return { ...turn, items: foldEvents(turn.items, event) };
}

const newId = () => crypto.randomUUID();

/**
 * The browser's view of the user's agent session: the transcript, approval cards and status as the bridge reports
 * them, and the requests, stops and decisions the user makes (by typing, clicking, nodding or shaking).
 */
export class AgentClient {
  private state = INITIAL;
  private readonly listeners = new Set<() => void>();
  /** Requests this page sent, by what they were for, so a refusal shows in the right place. */
  private readonly sentRequests = new Map<string, "chat" | "extensions">();

  constructor(private readonly send: (message: Message) => boolean) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AgentState => this.state;

  /** Cards waiting for the user. */
  get pending(): ApprovalView[] {
    return this.state.approvals.filter((a) => !a.outcome);
  }

  /** Handles a bridge message; returns false if it was not about the agent. */
  handle(message: Message): boolean {
    switch (message.type) {
      case "agent.transcript": {
        const { turns, status, pending } = message.payload;
        const running = turns.at(-1)?.events.some((e) => e.type === "turn.end")
          ? null
          : (turns.at(-1)?.id ?? null);
        this.update({
          status,
          turns: turns.map(turnView),
          approvals: pending.map((request) => ({ request, turnId: running })),
        });
        return true;
      }
      case "agent.status":
        this.update({ status: message.payload.status });
        return true;
      case "agent.turn": {
        const { id, request, recovered } = message.payload;
        this.update({ turns: [...this.state.turns, { id, request, recovered, items: [] }], error: null });
        return true;
      }
      case "agent.event": {
        const { turnId, event } = message.payload;
        this.update({ turns: this.state.turns.map((t) => (t.id === turnId ? withEvent(t, event) : t)) });
        return true;
      }
      case "approval.pending": {
        const running = this.state.turns.findLast((t) => !t.ended)?.id ?? null;
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

  /** Sends a typed request; false if the bridge is not connected. */
  request(text: string): boolean {
    const id = newId();
    this.sentRequests.set(id, "chat");
    this.update({ error: null });
    return this.send({ type: "agent.send", id, payload: { text } });
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

  /** Opens the panel with the cursor in the input ("Ask agent" in the palette). */
  requestFocus(): void {
    this.update({ focusTick: this.state.focusTick + 1 });
  }

  stop(): void {
    this.send({ type: "agent.stop", id: newId(), payload: {} });
  }

  decide(approvalId: string, decision: "allow" | "deny" | "always"): void {
    this.send({ type: "approval.decide", id: newId(), payload: { id: approvalId, decision } });
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

  /** Stops the running turn, if one runs (two open palms by default). */
  stopRunning(): void {
    if (this.state.status?.state === "working") this.stop();
  }

  private update(partial: Partial<AgentState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }
}
