import type { AgentStatus, TeamMemberInfo, TeamTask } from "@hai/protocol";
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ToolIcon } from "../tools/ToolOverlays.tsx";
import type { Speaker } from "../voice/speaker.ts";
import { MicButton, VoiceBar } from "../voice/VoiceBar.tsx";
import type { VoiceInput } from "../voice/voice-input.ts";
import { AgentsView } from "./AgentsView.tsx";
import {
  type AgentClient,
  type ApprovalView,
  displayName,
  type TeamView,
  type ToolOutcome,
  type TurnItem,
  type TurnView,
} from "./agent-client.ts";
import { ExtensionsView } from "./ExtensionsView.tsx";

const STATUS_LABEL: Record<AgentStatus["state"] | "connecting", string> = {
  connecting: "Connecting",
  unavailable: "Unavailable",
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
/** A specialist's state in the team strip. */
type MemberState = "idle" | "working" | "queued" | "waiting";
const MEMBER_STATE_LABEL: Record<MemberState, string> = {
  idle: "idle",
  working: "working",
  queued: "queued",
  waiting: "needs approval",
};
const TASK_STATUS_LABEL: Record<TeamTask["status"], string> = {
  queued: "queued",
  running: "working",
  waiting: "needs approval",
  done: "done",
  failed: "failed",
  stopped: "stopped",
};
const VIEW_LABEL = { chat: "Chat", agents: "Agents", extensions: "Extensions" } as const;
const COLLAPSED_KEY = "hai.agentCollapsed";
const CHEVRON_UP = "M6 15l6-6 6 6";
const CHEVRON_DOWN = "M6 9l6 6 6-6";
const CHEVRON_LEFT = "M15 6l-6 6 6 6";
const STOP_ICON = "M7 7h10v10H7z";
const SEND_ICON = "M5 12h13M13 6l6 6-6 6";
const SPEAKER_ICON = "M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13";
const SPEAKER_OFF_ICON = "M11 5 6 9H3v6h3l5 4V5zM16 9.5l5 5M21 9.5l-5 5";
/** Longest input or result text shown in an expanded chip. */
const DETAIL_MAX = 1200;

/** `mcp__server__tool` reads as "tool" from "server"; built-in tools keep their name. */
export function toolLabel(name: string): { tool: string; server?: string } {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match ? { tool: match[2] ?? name, server: match[1] ?? "" } : { tool: name };
}

const clip = (text: string) => (text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text);

const isActive = (task: TeamTask) => task.status === "running" || task.status === "waiting";

/** What a specialist is doing: its task in progress, else its next queued one, else its latest. */
function memberTask(team: TeamView, name: string): { state: MemberState; task: TeamTask | undefined } {
  const tasks = team.tasks.filter((t) => t.agent === name);
  const current = tasks.find(isActive);
  if (current) return { state: current.status === "waiting" ? "waiting" : "working", task: current };
  const queued = tasks.find((t) => t.status === "queued");
  if (queued) return { state: "queued", task: queued };
  return { state: "idle", task: tasks.at(-1) };
}

/** An agent's colour, for its dot. */
const colorOf = (member: TeamMemberInfo | undefined): CSSProperties =>
  ({ "--agent-color": member?.color ?? "var(--accent)" }) as CSSProperties;

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
        {request.agent && (
          <span className="approval-agent" data-testid="approval-agent">
            {displayName(request.agent)}
          </span>
        )}
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
  agent,
}: {
  item: Extract<TurnItem, { kind: "tool" }>;
  approval?: ApprovalView;
  /** The team agent that made the call. */
  agent?: string;
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
        {agent && (
          <span className="tool-chip-agent" data-testid="tool-chip-agent">
            {displayName(agent)}
          </span>
        )}
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

/** A task Mochi handed out, in Mochi's turn: its live status; pressing it opens the specialist's thread. */
function HandOffChip({
  task,
  member,
  onOpen,
}: {
  task: TeamTask;
  member: TeamMemberInfo | undefined;
  onOpen: (taskId: string) => void;
}) {
  return (
    <button
      type="button"
      className="handoff-chip"
      data-testid="handoff-chip"
      data-status={task.status}
      data-hand-press
      style={colorOf(member)}
      title={`Open ${displayName(task.agent)}'s work on this task`}
      onClick={() => onOpen(task.id)}
    >
      <span className="team-dot" aria-hidden="true" />
      <span className="handoff-agent">{displayName(task.agent)}</span>
      <span className="handoff-title">{task.title}</span>
      <span className="handoff-status">{TASK_STATUS_LABEL[task.status]}</span>
    </button>
  );
}

function Turn({
  turn,
  approvals,
  client,
  onlyPendingId,
  agent,
  team,
  onOpenTask,
  taskApprovals,
}: {
  turn: TurnView;
  approvals: ApprovalView[];
  client: AgentClient;
  onlyPendingId: string | null;
  /** The team agent whose turn this is (its name goes on the tool chips). */
  agent?: string;
  team?: TeamView | null;
  onOpenTask?: (taskId: string) => void;
  /** Every approval card, for the waiting cards of the tasks this turn handed out. */
  taskApprovals?: ApprovalView[];
}) {
  const handOffs = team?.tasks.filter((t) => t.fromTurn === turn.id) ?? [];
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
    <li
      className="agent-turn"
      data-testid="agent-turn"
      data-kind={turn.kind}
      data-ended={turn.ended ?? "running"}
    >
      {turn.kind === "request" && <p className="agent-request">{turn.request}</p>}
      {turn.kind === "digest" && <p className="agent-digest">Team update</p>}
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
            <ToolChip item={item} approval={approval} {...(agent ? { agent } : {})} />
            {approval && card(approval)}
          </div>
        );
      })}
      {unlinked.map(card)}
      {onOpenTask &&
        handOffs.map((task) => (
          <div key={task.id} className="agent-tool">
            <HandOffChip
              task={task}
              member={team?.members.find((m) => m.name === task.agent)}
              onOpen={onOpenTask}
            />
            {/* A specialist's card waits here too, so the user sees it without opening the task. */}
            {taskApprovals?.filter((a) => !a.outcome && a.turnId === task.turnId).map(card)}
          </div>
        ))}
      {!turn.ended && <span className="agent-working" role="img" aria-label="Working" />}
      {turn.ended === "stopped" && (
        <p className="agent-ended">Stopped. Changes made so far are kept as one undo step.</p>
      )}
    </li>
  );
}

/** Mutes or unmutes Mochi's spoken replies (remembered); it shows when Mochi is speaking. */
function SpeakToggle({
  speaker,
  on,
  onChange,
}: {
  speaker: Speaker;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  const speaking = useSyncExternalStore(speaker.subscribe, () => speaker.speaking);
  const label = on ? "Mute spoken replies" : "Speak replies aloud";
  return (
    <button
      type="button"
      className="icon-button speak-toggle"
      data-testid="speak-toggle"
      data-speaking={speaking}
      data-hand-press
      aria-pressed={!on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
    >
      <ToolIcon path={on ? SPEAKER_ICON : SPEAKER_OFF_ICON} size={18} />
    </button>
  );
}

/**
 * Every specialist and its state. While everyone is idle it is one compact row, so it covers little of the model;
 * with work under way each specialist gets a chip with its task. Pressing one opens its task's thread.
 */
function TeamStrip({
  team,
  client,
  onOpenTask,
}: {
  team: TeamView;
  client: AgentClient;
  onOpenTask: (taskId: string) => void;
}) {
  const specialists = team.members.filter((m) => !m.lead);
  const working = team.tasks.filter(isActive).length;
  const queued = team.tasks.filter((t) => t.status === "queued").length;
  const summary = [working ? `${working} working` : "", queued ? `${queued} queued` : ""].filter(Boolean);
  const idle = summary.length === 0;
  const chips = specialists.map((member) => {
    const { state, task } = memberTask(team, member.name);
    const shown = state === "idle" ? undefined : task;
    return (
      <button
        key={member.name}
        type="button"
        className="team-chip"
        data-testid={`team-chip-${member.name}`}
        data-state={state}
        data-hand-press
        style={colorOf(member)}
        disabled={!task}
        title={
          task
            ? `${displayName(member.name)}: ${task.title} (${TASK_STATUS_LABEL[task.status]})`
            : `${displayName(member.name)}: ${member.description}`
        }
        onClick={() => task && onOpenTask(task.id)}
      >
        <span className="team-dot" aria-hidden="true" />
        <span className="team-chip-name">{displayName(member.name)}</span>
        {!idle && <span className="team-chip-state">{shown ? shown.title : MEMBER_STATE_LABEL[state]}</span>}
      </button>
    );
  });
  return (
    <div className="team-strip" data-testid="team-strip" data-idle={idle}>
      <div className="team-strip-head">
        <span className="team-strip-label">Team</span>
        {idle ? (
          <span className="team-names" title="All idle">
            {chips}
          </span>
        ) : (
          <>
            <span className="team-strip-summary" data-testid="team-summary">
              {summary.join(", ")}
            </span>
            <button
              type="button"
              className="team-stop"
              data-testid="team-stop"
              data-hand-press
              title="Stop every agent (or clench both fists, then open your hands)"
              onClick={() => client.stop()}
            >
              Stop all
            </button>
          </>
        )}
      </div>
      {!idle && <div className="team-grid">{chips}</div>}
    </div>
  );
}

/** The head of a task's thread: the specialist and task, its status, a stop, and the way back to Mochi's chat. */
function TaskHead({
  task,
  team,
  client,
  onBack,
}: {
  task: TeamTask;
  team: TeamView;
  client: AgentClient;
  onBack: () => void;
}) {
  const member = team.members.find((m) => m.name === task.agent);
  const lead = displayName(client.lead);
  return (
    <div className="task-thread" data-testid="task-thread" style={colorOf(member)}>
      <div className="task-head">
        <button
          type="button"
          className="icon-button"
          data-testid="task-back"
          data-hand-press
          aria-label={`Back to ${lead}`}
          title={`Back to ${lead}`}
          onClick={onBack}
        >
          <ToolIcon path={CHEVRON_LEFT} size={16} />
        </button>
        <span className="team-dot" aria-hidden="true" />
        <span className="task-title">
          <strong>{displayName(task.agent)}</strong> {task.title}
        </span>
        <span className="task-status" data-testid="task-status" data-status={task.status}>
          {TASK_STATUS_LABEL[task.status]}
        </span>
        {(isActive(task) || task.status === "queued") && (
          <button
            type="button"
            className="team-stop"
            data-testid="task-stop"
            data-hand-press
            title={`Stop ${displayName(task.agent)}'s task`}
            onClick={() => client.stopTask(task.id)}
          >
            Stop
          </button>
        )}
      </div>
      <p className="task-instruction">{task.instruction}</p>
    </div>
  );
}

/**
 * The agent panel over the model: the conversation with Mochi, the team lead, the team strip and each specialist's
 * work on its tasks, tool calls as chips, approval cards, status, a typed input and stop. Its buttons can be pressed
 * by hand; gestures reach it through the input router (a nod or shake answers the only waiting card, both fists then
 * open hands stop everything).
 */
export function AgentPanel({
  client,
  voice,
  startVoice,
  voiceOn = true,
  voiceNotice = null,
  nameOf,
  speaker,
  speakReplies,
  onSpeakReplies,
}: {
  client: AgentClient;
  /** Voice is the main way to ask: the microphone button comes first and typing is the fallback. */
  voice: VoiceInput;
  startVoice: () => void;
  /** The voice feature is on (Settings > Features): without it there is no microphone, only typing. */
  voiceOn?: boolean;
  /** Why voice cannot be used yet (its models are still downloading), or null when it can. */
  voiceNotice?: string | null;
  /** An element's name, for the references a spoken request carries. */
  nameOf: (id: string) => string;
  /** Mochi's voice: speaking shows on the toggle, which mutes or unmutes it. */
  speaker: Speaker;
  speakReplies: boolean;
  onSpeakReplies: (on: boolean) => void;
}) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<"chat" | "agents" | "extensions">("chat");
  /** The task whose thread is open, instead of Mochi's chat. */
  const [openTask, setOpenTask] = useState<string | null>(null);
  const transcript = useRef<HTMLOListElement>(null);
  const team = state.team && state.team.members.length > 0 ? state.team : null;
  const task = (openTask && team?.tasks.find((t) => t.id === openTask)) || null;
  const taskTurns = task ? client.thread(task.agent).turns.filter((t) => t.taskId === task.id) : [];
  const shownTurns = task ? taskTurns : state.turns;
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
    setOpenTask(null);
  }, [state.openTick]);

  // Follow the conversation as it grows, unless the user scrolled up to read. A new request or a new approval card
  // always comes into view: the card is waiting for the user.
  const lastTurn = shownTurns.at(-1);
  const following = useRef(true);
  const seen = useRef({ turns: 0, pending: 0 });
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run whenever the transcript, cards or board change
  useEffect(() => {
    const el = transcript.current;
    if (!el) return;
    const arrived = shownTurns.length > seen.current.turns || pending.length > seen.current.pending;
    seen.current = { turns: shownTurns.length, pending: pending.length };
    if (arrived || following.current) {
      el.scrollTop = el.scrollHeight;
      following.current = true;
    }
  }, [shownTurns.length, lastTurn, state.approvals, state.team, collapsed, openTask]);
  const onTranscriptScroll = () => {
    const el = transcript.current;
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    if (client.ask(draft.trim())) setDraft("");
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
        <span className="agent-title" data-testid="agent-title">
          {team ? displayName(client.lead) : "Agent"}
        </span>
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
            {(["chat", "agents", "extensions"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                data-testid={`agent-tab-${v}`}
                data-hand-press
                onClick={() => setView(v)}
              >
                {VIEW_LABEL[v]}
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
      {!collapsed && view === "agents" && <AgentsView client={client} />}
      {!collapsed && view === "extensions" && <ExtensionsView client={client} />}
      {!collapsed && view === "chat" && (
        <>
          {state.status?.state === "unavailable" && (
            <div className="agent-unavailable" data-testid="agent-unavailable" role="status">
              <strong>{state.status.reason}</strong>
              {state.status.fix && <span>{state.status.fix}</span>}
            </div>
          )}
          {team?.members.some((m) => !m.lead) && (
            <TeamStrip team={team} client={client} onOpenTask={setOpenTask} />
          )}
          {task && team && (
            <TaskHead task={task} team={team} client={client} onBack={() => setOpenTask(null)} />
          )}
          <ol
            className="agent-transcript"
            ref={transcript}
            data-testid={task ? "task-transcript" : "agent-transcript"}
            aria-live="polite"
            onScroll={onTranscriptScroll}
          >
            {task && taskTurns.length === 0 && (
              <li className="agent-empty muted">
                {task.status === "queued"
                  ? "Queued: it starts when the agents before it have finished."
                  : `${TASK_STATUS_LABEL[task.status]}.`}
              </li>
            )}
            {task &&
              taskTurns.map((turn) => (
                <Turn
                  key={turn.id}
                  turn={turn}
                  approvals={state.approvals.filter((a) => a.turnId === turn.id)}
                  client={client}
                  onlyPendingId={onlyPendingId}
                  agent={task.agent}
                />
              ))}
            {!task && state.turns.length === 0 && state.status?.state !== "unavailable" && (
              <li className="agent-empty muted">
                Press the microphone (or hold the ` key) and say what to change, for example "add three floors
                of 3.5 m to this block". Point at elements while you speak to say which ones, or select them
                first.
              </li>
            )}
            {!task &&
              state.turns.map((turn) => (
                <Turn
                  key={turn.id}
                  turn={turn}
                  approvals={state.approvals.filter((a) => a.turnId === turn.id)}
                  client={client}
                  onlyPendingId={onlyPendingId}
                  {...(team
                    ? { agent: client.lead, team, onOpenTask: setOpenTask, taskApprovals: state.approvals }
                    : {})}
                />
              ))}
          </ol>
          {voiceOn && <VoiceBar voice={voice} nameOf={nameOf} />}
          <form className="agent-input" onSubmit={submit}>
            {voiceOn && (
              <MicButton
                voice={voice}
                onStart={startVoice}
                disabled={status === "unavailable"}
                notice={voiceNotice}
              />
            )}
            <SpeakToggle speaker={speaker} on={speakReplies} onChange={onSpeakReplies} />
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
                title="Stop (or clench both fists, then open your hands)"
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
