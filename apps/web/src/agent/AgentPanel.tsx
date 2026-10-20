import type { AgentStatus } from "@aex/protocol";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ToolIcon } from "../tools/ToolOverlays.tsx";
import { MicButton, VoiceBar } from "../voice/VoiceBar.tsx";
import type { VoiceInput } from "../voice/voice-input.ts";
import type { AgentClient, ApprovalView, ToolOutcome, TurnItem, TurnView } from "./agent-client.ts";
import { ExtensionsView } from "./ExtensionsView.tsx";

const STATUS_LABEL: Record<AgentStatus["state"] | "connecting", string> = {
  connecting: "Connecting",
  unavailable: "Not available",
  starting: "Starting",
  idle: "Ready",
  working: "Working",
  recovering: "Recovering",
};
const OUTCOME_LABEL: Record<ToolOutcome | "waiting", string> = {
  waiting: "needs approval",
  running: "running",
  done: "done",
  failed: "failed",
  denied: "denied",
};
const APPROVAL_LABEL = { allowed: "Allowed", denied: "Denied", "timed-out": "Timed out" } as const;
const COLLAPSED_KEY = "aex.agentCollapsed";
const CHEVRON_UP = "M6 15l6-6 6 6";
const CHEVRON_DOWN = "M6 9l6 6 6-6";
const STOP_ICON = "M7 7h10v10H7z";
const SEND_ICON = "M5 12h13M13 6l6 6-6 6";
/** Longest input or result text shown in an expanded chip. */
const DETAIL_MAX = 1200;

/** `mcp__server__tool` reads as "tool" from "server"; built-in tools keep their name. */
export function toolLabel(name: string): { tool: string; server?: string } {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match ? { tool: match[2] ?? name, server: match[1] ?? "" } : { tool: name };
}

const clip = (text: string) => (text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text);

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(value));
  } catch {
    // Storage blocked: the panel opens expanded next time.
  }
}

/** Seconds until a pending card is denied, refreshed every second. */
function useSecondsLeft(expiresAt: number, active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

function ApprovalCard({
  approval,
  client,
  only,
}: {
  approval: ApprovalView;
  client: AgentClient;
  /** The only waiting card: nod and shake decide it. */
  only: boolean;
}) {
  const { request, outcome } = approval;
  const label = toolLabel(request.tool);
  const seconds = useSecondsLeft(request.expiresAt, !outcome);
  return (
    <section
      className="approval-card"
      data-testid="approval-card"
      data-outcome={outcome ?? "pending"}
      aria-label={`Allow ${label.tool}?`}
    >
      <div className="approval-head">
        <strong>{outcome ? label.tool : `Allow ${label.tool}?`}</strong>
        <span className="muted">{request.source}</span>
      </div>
      <code className="approval-summary" data-testid="approval-summary">
        {request.summary}
      </code>
      {outcome ? (
        <p className="approval-outcome" data-testid="approval-outcome">
          {APPROVAL_LABEL[outcome]}
        </p>
      ) : (
        <>
          <div className="approval-actions">
            <button
              type="button"
              className="primary"
              data-hand-press
              onClick={() => client.decide(request.id, "allow")}
            >
              Allow
            </button>
            <button
              type="button"
              className="secondary"
              data-hand-press
              onClick={() => client.decide(request.id, "deny")}
            >
              Deny
            </button>
            <button
              type="button"
              className="secondary"
              data-hand-press
              title="Allow this tool from now on in this project (revoke it in Agent permissions)"
              onClick={() => client.decide(request.id, "always")}
            >
              Always allow
            </button>
          </div>
          <p className="approval-hint muted">
            {only ? "Nod to allow, shake to deny. " : ""}Denied in {seconds} s if unanswered.
          </p>
        </>
      )}
    </section>
  );
}

function ToolChip({
  item,
  approval,
}: {
  item: Extract<TurnItem, { kind: "tool" }>;
  approval?: ApprovalView;
}) {
  const label = toolLabel(item.name);
  const declined = approval?.outcome === "denied" || approval?.outcome === "timed-out";
  let outcome: ToolOutcome | "waiting" = item.outcome;
  if (declined && item.outcome !== "done") outcome = "denied";
  else if (approval && !approval.outcome && item.outcome === "running") outcome = "waiting";
  const input = JSON.stringify(item.input ?? {}, null, 2);
  return (
    <details className="tool-chip" data-testid="tool-chip" data-outcome={outcome}>
      <summary>
        <span className="tool-chip-dot" aria-hidden="true" />
        <span className="tool-chip-name">{label.tool}</span>
        {label.server && <span className="tool-chip-server">{label.server}</span>}
        <span className="tool-chip-outcome">{OUTCOME_LABEL[outcome]}</span>
      </summary>
      <div className="tool-chip-detail">
        <span className="muted">Input</span>
        <pre>{clip(input)}</pre>
        {item.summary !== undefined && (
          <>
            <span className="muted">{outcome === "done" ? "Result" : "Error"}</span>
            <pre data-testid="tool-chip-result">{clip(item.summary)}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function Turn({
  turn,
  approvals,
  client,
  onlyPendingId,
}: {
  turn: TurnView;
  approvals: ApprovalView[];
  client: AgentClient;
  onlyPendingId: string | null;
}) {
  const toolIds = new Set(turn.items.flatMap((i) => (i.kind === "tool" ? [i.id] : [])));
  const cardFor = (toolId: string) => approvals.find((a) => a.request.toolUseId === toolId);
  // A card sits under its tool chip; one whose tool call the provider did not name goes at the end of the turn.
  const unlinked = approvals.filter((a) => !a.request.toolUseId || !toolIds.has(a.request.toolUseId));
  const card = (approval: ApprovalView) => (
    <ApprovalCard
      key={approval.request.id}
      approval={approval}
      client={client}
      only={approval.request.id === onlyPendingId}
    />
  );
  return (
    <li className="agent-turn" data-testid="agent-turn" data-ended={turn.ended ?? "running"}>
      <p className="agent-request">{turn.request}</p>
      {turn.recovered && (
        <p className="agent-notice" data-testid="agent-recovered">
          Session recovered: the agent restarted and continued the conversation.
        </p>
      )}
      {turn.items.map((item, i) => {
        if (item.kind === "text")
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: items only ever append, so the index is stable
            <p key={i} className="agent-text" data-testid="agent-text">
              {item.text}
            </p>
          );
        if (item.kind === "error")
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: items only ever append, so the index is stable
            <p key={i} className="agent-error" role="alert">
              {item.message}
            </p>
          );
        const approval = cardFor(item.id);
        return (
          <div key={item.id} className="agent-tool">
            <ToolChip item={item} approval={approval} />
            {approval && card(approval)}
          </div>
        );
      })}
      {unlinked.map(card)}
      {!turn.ended && <span className="agent-working" role="img" aria-label="Working" />}
      {turn.ended === "stopped" && (
        <p className="agent-ended">Stopped. Changes made so far are kept as one undo step.</p>
      )}
    </li>
  );
}

/**
 * The agent panel over the model: the conversation with the user's own Claude, its tool calls as chips, approval
 * cards, status, a typed input and stop. Its buttons can be pressed by hand; gestures reach it through the input
 * router (a nod or shake answers the only waiting card, two open palms stop).
 */
export function AgentPanel({
  client,
  voice,
  startVoice,
  nameOf,
}: {
  client: AgentClient;
  /** Voice is the main way to ask: the microphone button comes first and typing is the fallback. */
  voice: VoiceInput;
  startVoice: () => void;
  /** An element's name, for the references a spoken request carries. */
  nameOf: (id: string) => string;
}) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<"chat" | "extensions">("chat");
  const transcript = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const status = state.status?.state ?? "connecting";
  const working = status === "working";
  const canSend = status === "idle" && draft.trim().length > 0;
  const pending = state.approvals.filter((a) => !a.outcome);
  const onlyPendingId = pending.length === 1 ? (pending[0]?.request.id ?? null) : null;

  const setPanelCollapsed = (value: boolean) => {
    setCollapsed(value);
    writeCollapsed(value);
  };

  // A voice request starting (the microphone button, the talk key, Ask agent) shows the panel on the chat.
  useEffect(() => {
    if (state.openTick === 0) return;
    setCollapsed(false);
    writeCollapsed(false);
    setView("chat");
  }, [state.openTick]);

  // Follow the conversation as it grows, unless the user scrolled up to read. A new request or a new approval card
  // always comes into view: the card is waiting for the user.
  const lastTurn = state.turns.at(-1);
  const following = useRef(true);
  const seen = useRef({ turns: 0, pending: 0 });
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run whenever the transcript or cards change
  useEffect(() => {
    const el = transcript.current;
    if (!el) return;
    const arrived = state.turns.length > seen.current.turns || pending.length > seen.current.pending;
    seen.current = { turns: state.turns.length, pending: pending.length };
    if (arrived || following.current) {
      el.scrollTop = el.scrollHeight;
      following.current = true;
    }
  }, [state.turns.length, lastTurn, state.approvals, collapsed]);
  const onTranscriptScroll = () => {
    const el = transcript.current;
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    if (client.request(draft.trim())) setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section
      className="agent-panel"
      data-testid="agent-panel"
      data-collapsed={collapsed}
      data-hud
      aria-label="Agent"
    >
      <header className="agent-head">
        <span className="agent-title">Agent</span>
        <output className="agent-status" data-testid="agent-status" data-state={status}>
          <span className="agent-dot" aria-hidden="true" />
          {STATUS_LABEL[status]}
        </output>
        {collapsed && pending.length > 0 && (
          <span className="agent-badge" data-testid="agent-pending-badge">
            {pending.length} to approve
          </span>
        )}
        {!collapsed && (
          <div className="agent-tabs" role="tablist" aria-label="Agent views">
            {(["chat", "extensions"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                data-testid={`agent-tab-${v}`}
                data-hand-press
                onClick={() => setView(v)}
              >
                {v === "chat" ? "Chat" : "Extensions"}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="icon-button"
          data-hand-press
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show the agent panel" : "Hide the agent panel"}
          title={collapsed ? "Show the agent panel" : "Hide the agent panel"}
          onClick={() => setPanelCollapsed(!collapsed)}
        >
          <ToolIcon path={collapsed ? CHEVRON_DOWN : CHEVRON_UP} size={16} />
        </button>
      </header>
      {!collapsed && view === "extensions" && <ExtensionsView client={client} />}
      {!collapsed && view === "chat" && (
        <>
          {state.status?.state === "unavailable" && (
            <div className="agent-unavailable" data-testid="agent-unavailable" role="status">
              <strong>{state.status.reason}</strong>
              {state.status.fix && <span>{state.status.fix}</span>}
            </div>
          )}
          <ol
            className="agent-transcript"
            ref={transcript}
            data-testid="agent-transcript"
            aria-live="polite"
            onScroll={onTranscriptScroll}
          >
            {state.turns.length === 0 && state.status?.state !== "unavailable" && (
              <li className="agent-empty muted">
                Press the microphone (or hold the ` key) and say what to change, for example "add three floors
                of 3.5 m to this block". Point at elements while you speak to say which ones, or select them
                first.
              </li>
            )}
            {state.turns.map((turn) => (
              <Turn
                key={turn.id}
                turn={turn}
                approvals={state.approvals.filter((a) => a.turnId === turn.id)}
                client={client}
                onlyPendingId={onlyPendingId}
              />
            ))}
          </ol>
          <VoiceBar voice={voice} nameOf={nameOf} />
          <form className="agent-input" onSubmit={submit}>
            <MicButton voice={voice} onStart={startVoice} disabled={status === "unavailable"} />
            <textarea
              ref={input}
              value={draft}
              rows={1}
              placeholder={working ? "The agent is working..." : "Speak, or type a request"}
              aria-label="Request for the agent"
              data-testid="agent-input"
              disabled={status === "unavailable"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
            />
            {working ? (
              <button
                type="button"
                className="icon-button stop"
                data-testid="agent-stop"
                data-hand-press
                aria-label="Stop the agent"
                title="Stop (or hold up both open palms)"
                onClick={() => client.stop()}
              >
                <ToolIcon path={STOP_ICON} size={16} />
              </button>
            ) : (
              <button
                type="submit"
                className="icon-button send"
                data-testid="agent-send"
                aria-label="Send"
                title="Send (Enter)"
                disabled={!canSend}
              >
                <ToolIcon path={SEND_ICON} size={16} />
              </button>
            )}
          </form>
          {state.error && (
            <p className="agent-input-error" role="alert" data-testid="agent-error">
              {state.error}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Settings: the tools the user chose "Always allow" for in this project, each removable. */
export function AgentPermissions({ client }: { client: AgentClient }) {
  const { alwaysAllowed } = useSyncExternalStore(client.subscribe, client.getSnapshot);
  return (
    <section
      className="palette-settings agent-permissions"
      data-testid="agent-permissions"
      aria-label="Agent permissions"
    >
      <header className="detection-head">
        <h2>Agent permissions</h2>
        <span className="muted">this project</span>
      </header>
      {alwaysAllowed.length === 0 ? (
        <p className="muted">
          No tools are always allowed in this project. Choose "Always allow" on an approval card to add one.
        </p>
      ) : (
        <ul className="allowed-tools">
          {alwaysAllowed.map((tool) => {
            const label = toolLabel(tool);
            return (
              <li key={tool} data-testid="allowed-tool">
                <span>
                  {label.tool}
                  {label.server && <span className="muted"> {label.server}</span>}
                </span>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Stop always allowing ${label.tool}`}
                  onClick={() => client.revoke(tool)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted">
        Scene tools always run without asking, because every change shows in the model and can be undone.
      </p>
    </section>
  );
}
