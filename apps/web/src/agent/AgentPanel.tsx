import {
  type AgentStatus,
  DEFAULT_STRIP,
  PANEL_OFFER_TIMEOUT_MS,
  type PanelOfferState,
  type StripLayout,
  type TeamMemberInfo,
  type TeamShot,
  type TeamTask,
} from "@hai/protocol";
import {
  type CSSProperties,
  type FormEvent,
  Fragment,
  type KeyboardEvent,
  memo,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { OfferView, PanelClient } from "../panel/panel-client.ts";
import { ToolIcon } from "../tools/ToolOverlays.tsx";
import { rememberedShot } from "../viewer/agent-shot.ts";
import type { Speaker } from "../voice/speaker.ts";
import { MicButton, VoiceBar } from "../voice/VoiceBar.tsx";
import type { VoiceInput } from "../voice/voice-input.ts";
import { AgentFace } from "./AgentFace.tsx";
import { AgentsView } from "./AgentsView.tsx";
import {
  type AgentClient,
  type ApprovalView,
  displayName,
  type PlanView,
  type RunReportView,
  type TeamView,
  type ToolOutcome,
  type TurnItem,
  type TurnView,
  type WrittenFile,
} from "./agent-client.ts";
import { ExtensionsView } from "./ExtensionsView.tsx";
import { baseAgent, scopeLabel } from "./owners.ts";
import { planStrip } from "./rail-strip.ts";
import { clampReply } from "./reply-clamp.ts";

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
const OFFER_LABEL: Record<PanelOfferState, string> = {
  waiting: "Waiting for you",
  accepted: "Opened",
  skipped: "Skipped",
  expired: "Expired",
  unused: "No panel was made",
};
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
const WIDTH_KEY = "hai.agentWidth";
/** The rail's width is dragged between these; a hand press on its edge steps up through RAIL_STEPS, then back to the least. */
const RAIL_MIN = 320;
const RAIL_MAX = 560;
const RAIL_DEFAULT = 380;
const RAIL_STEPS = [RAIL_DEFAULT, 460, RAIL_MAX];
const CHEVRON_LEFT = "M15 6l-6 6 6 6";
const CHEVRON_RIGHT = "M9 6l6 6-6 6";
/** What the collapsed strip keeps for itself, pixels: its padding, the chevron button and the gap after it. */
const CHEVRON_ROOM = 8 + 8 + 40 + 12;
const TRAY_ICON = "M6 15l6-6 6 6";
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

/** The script a code tool (python_run, rhino_run_python) would run, or null for any other call. */
function codeOf(input: unknown): string | null {
  const code = typeof input === "object" && input !== null ? (input as { code?: unknown }).code : undefined;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/** The `.3dm` files a Python run declared it will write, or none. */
function outputsOf(input: unknown): string[] {
  const outputs =
    typeof input === "object" && input !== null ? (input as { outputs?: unknown }).outputs : undefined;
  return Array.isArray(outputs) ? outputs.filter((o): o is string => typeof o === "string") : [];
}

const clip = (text: string) => (text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text);

const isActive = (task: TeamTask) => task.status === "running" || task.status === "waiting";

/** What a specialist is doing: its task in progress, else its next queued one, else its latest. */
function memberTask(team: TeamView, name: string): { state: MemberState; task: TeamTask | undefined } {
  const tasks = team.tasks.filter((t) => t.agent === name);
  const current = tasks.find(isActive);
  if (current) {
    const blocked =
      current.status === "waiting" ||
      team.tasks.some((t) => t.parent === current.id && t.status === "waiting");
    return { state: blocked ? "waiting" : "working", task: current };
  }
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

const clampWidth = (px: number) => Math.round(Math.min(RAIL_MAX, Math.max(RAIL_MIN, px)));

function readWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : RAIL_DEFAULT;
  } catch {
    return RAIL_DEFAULT;
  }
}

function writeWidth(value: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(value));
  } catch {
    // Storage blocked: the rail opens at its default width next time.
  }
}

/**
 * The rail's right edge: drag it to widen or narrow the chat, use the arrow keys, double-click for the default, or
 * press it by hand (a hand press cannot drag) to step through a few widths.
 */
function RailHandle({ width, onWidth }: { width: number; onWidth: (px: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const step = () => onWidth(RAIL_STEPS.find((w) => w > width) ?? RAIL_MIN);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator that resizes is the WAI-ARIA window splitter
    <div
      className="agent-rail-resize"
      data-testid="agent-rail-resize"
      data-hand-press
      role="separator"
      aria-orientation="vertical"
      aria-label="Chat width"
      aria-valuemin={RAIL_MIN}
      aria-valuemax={RAIL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize the chat (double-click for the default)"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width };
      }}
      onPointerMove={(e) => {
        const start = drag.current;
        if (start) onWidth(clampWidth(start.width + e.clientX - start.x));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onClick={(e) => {
        // A hand press arrives as a click with no pointer down first.
        if (e.detail === 0) step();
      }}
      onDoubleClick={() => onWidth(RAIL_DEFAULT)}
      onKeyDown={(e) => {
        switch (e.key) {
          case "ArrowRight":
            onWidth(clampWidth(width + 16));
            break;
          case "ArrowLeft":
            onWidth(clampWidth(width - 16));
            break;
          case "Home":
            onWidth(RAIL_MIN);
            break;
          case "End":
            onWidth(RAIL_MAX);
            break;
          default:
            return;
        }
        e.preventDefault();
      }}
    />
  );
}

function writeCollapsed(value: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(value));
  } catch {
    // Storage blocked: the panel opens expanded next time.
  }
}

/** A settled plan in one line: what became of it and who did the parts. */
function planSummary(plan: PlanView): string {
  const kept = plan.parts.filter((p) => plan.keep?.includes(p.id));
  if (plan.outcome === "confirmed") {
    const who = [...new Set(kept.map((p) => displayName(p.agent)))];
    const names = who.length > 2 ? `${who.slice(0, 2).join(", ")} +${who.length - 2}` : who.join(", ");
    return `Plan: ${kept.length} of ${plan.parts.length} parts, ${names}`;
  }
  return plan.outcome === "skipped" ? "Plan skipped: nothing was handed out" : "Plan not answered";
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

/** Mochi's plan for a request: the parts with who does each, the user removes what they do not want and confirms. */
function PlanCard({ plan, team, client }: { plan: PlanView; team: TeamView | null; client: AgentClient }) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const waiting = plan.outcome === undefined;
  const seconds = useSecondsLeft(plan.expiresAt, waiting);
  const kept = plan.parts.filter((p) => !removed.has(p.id));
  const shown = waiting ? plan.parts : plan.parts.filter((p) => plan.keep?.includes(p.id));
  const memberOf = (name: string) => team?.members.find((m) => m.name === baseAgent(name));
  return (
    <section
      className="plan-card"
      data-testid="plan-card"
      data-outcome={plan.outcome ?? "pending"}
      aria-label="Mochi's plan"
    >
      <div className="approval-head">
        <strong>{waiting ? "Mochi's plan" : "The plan"}</strong>
        <span className="muted">
          {waiting
            ? `${plan.parts.length} parts: remove what you do not want`
            : plan.outcome === "confirmed"
              ? `Confirmed: ${shown.length} of ${plan.parts.length} parts`
              : plan.outcome === "skipped"
                ? "Skipped: nothing was handed out"
                : "Not answered: nothing was handed out"}
        </span>
      </div>
      <ul className="plan-parts">
        {shown.map((part) => (
          <li
            key={part.id}
            className="plan-part"
            data-testid="plan-part"
            style={colorOf(memberOf(part.agent))}
            data-removed={removed.has(part.id) ? "true" : undefined}
          >
            <span className="team-dot" aria-hidden="true" />
            <span className="plan-part-agent">{displayName(part.agent)}</span>
            <span className="plan-part-title">{part.title}</span>
            <span className="plan-part-scope">{scopeLabel(part.scope ?? null)}</span>
            {waiting && (
              <button
                type="button"
                className="icon-button plan-part-remove"
                data-testid="plan-part-remove"
                data-hand-press
                aria-label={`Remove ${part.title}`}
                title={`Remove "${part.title}" from the plan`}
                disabled={kept.length === 1 && !removed.has(part.id)}
                onClick={() => setRemoved(new Set([...removed, part.id]))}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {waiting && (
        <div className="approval-actions">
          <button
            type="button"
            className="primary"
            data-testid="plan-confirm"
            data-hand-press
            onClick={() =>
              client.answerPlan(
                plan.id,
                kept.map((p) => p.id),
              )
            }
          >
            {kept.length === plan.parts.length ? "Confirm" : `Confirm ${kept.length} of ${plan.parts.length}`}
          </button>
          <button
            type="button"
            className="secondary"
            data-testid="plan-skip"
            data-hand-press
            onClick={() => client.answerPlan(plan.id, null)}
          >
            Skip
          </button>
        </div>
      )}
      {waiting && (
        <p className="approval-hint muted">
          Nothing is handed out until you confirm. Skipped in {seconds} s if unanswered.
        </p>
      )}
    </section>
  );
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
  const code = codeOf(request.input);
  const outputs = outputsOf(request.input);
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
        <strong className="approval-title">{outcome ? label.tool : `Allow ${label.tool}?`}</strong>
        <span className="muted approval-source">{request.source}</span>
      </div>
      <code className="approval-summary" data-testid="approval-summary">
        {request.summary}
      </code>
      {code !== null && (
        // A script the agent wants to run is shown whole and scrolls; the user decides on what it will really do.
        <section aria-label="Script to run">
          <pre className="approval-code" data-testid="approval-code">
            {code}
          </pre>
        </section>
      )}
      {outputs.length > 0 && (
        <p className="approval-installs" data-testid="approval-outputs">
          Will write: <code>{outputs.join(", ")}</code>
        </p>
      )}
      {request.installs && request.installs.length > 0 && (
        <p className="approval-installs" data-testid="approval-installs">
          Installs on your machine: <code>{request.installs.join(", ")}</code>
        </p>
      )}
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
            {!request.once && (
              <button
                type="button"
                className="secondary"
                data-hand-press
                title="Allow this tool from now on in this project (revoke it in Agent permissions)"
                onClick={() => client.decide(request.id, "always")}
              >
                Always allow
              </button>
            )}
          </div>
          <p className="approval-hint muted">
            {only ? "Nod to allow, shake to deny. " : ""}Denied in {seconds} s if unanswered.
          </p>
        </>
      )}
    </section>
  );
}

/** A piece of the agent's reply. A long one, once finished, shows its first sentences and a way to read the rest. */
function ReplyText({ text, settled, lead }: { text: string; settled: boolean; lead: boolean }) {
  const [open, setOpen] = useState(false);
  const { shown, clipped } = settled && !open ? clampReply(text) : { shown: text, clipped: false };
  return (
    <p className="agent-text" data-testid="agent-text" data-lead={lead ? "true" : undefined}>
      {shown}
      {clipped && (
        <button
          type="button"
          className="agent-text-more"
          data-testid="agent-text-more"
          data-hand-press
          onClick={() => setOpen(true)}
        >
          Show more
        </button>
      )}
    </p>
  );
}

/** The agent's offer of a panel: Open and Skip while it waits, then what became of it. */
function OfferCard({
  offer,
  panels,
  only,
}: {
  offer: OfferView;
  panels: PanelClient;
  /** The only thing waiting for a yes or no: nod and shake decide it. */
  only: boolean;
}) {
  const waiting = offer.state === "waiting";
  const seconds = useSecondsLeft(offer.at + PANEL_OFFER_TIMEOUT_MS, waiting);
  return (
    <section
      className="offer-card"
      data-testid="offer-card"
      data-state={offer.state}
      aria-label="Panel offer"
    >
      <div className="offer-head">
        {offer.agent && (
          <span className="approval-agent" data-testid="offer-agent">
            {displayName(offer.agent)}
          </span>
        )}
        <strong>{waiting ? "Open a panel?" : "Panel offer"}</strong>
      </div>
      <p className="offer-purpose" data-testid="offer-purpose">
        {offer.purpose}
      </p>
      {waiting ? (
        <>
          <div className="offer-actions">
            <button
              type="button"
              className="primary"
              data-testid="offer-open"
              data-hand-press
              onClick={() => panels.answer(offer.offerId, true)}
            >
              Open
            </button>
            <button
              type="button"
              className="secondary"
              data-testid="offer-skip"
              data-hand-press
              onClick={() => panels.answer(offer.offerId, false)}
            >
              Skip
            </button>
          </div>
          <p className="offer-hint muted">
            {only ? "Nod to open, shake to skip. " : ""}Expires in {seconds} s.
          </p>
        </>
      ) : (
        <p className="offer-outcome" data-testid="offer-outcome">
          {OFFER_LABEL[offer.state]}
        </p>
      )}
    </section>
  );
}

/**
 * `.3dm` files the agent's Python wrote: each can be brought into the viewer with one click, or opened in Rhino when
 * it is connected. Nothing is imported or opened until the user chooses it.
 */
function WrittenFiles({
  files,
  rhinoConnected,
  onImport,
  onOpenInRhino,
  onDismiss,
}: {
  files: WrittenFile[];
  rhinoConnected: boolean;
  onImport: (path: string) => void;
  onOpenInRhino: (path: string) => void;
  onDismiss: (path: string) => void;
}) {
  return (
    <ul className="written-files" data-testid="written-files" aria-label="Files the agent wrote">
      {files.map((file) => (
        <li
          key={file.path}
          className="written-file"
          data-testid={file.outside ? "written-outside" : "written-file"}
        >
          <span className="written-name" title={`${file.script} wrote this`}>
            {file.path}
          </span>
          {file.outside && (
            <span className="muted" data-testid="written-outside-note">
              changed during a run, outside what it declared
            </span>
          )}
          {!file.outside && (
            <button
              type="button"
              className="primary"
              data-testid="written-import"
              data-hand-press
              onClick={() => {
                onImport(file.path);
                onDismiss(file.path);
              }}
            >
              Import into viewer
            </button>
          )}
          {rhinoConnected && !file.outside && (
            <button
              type="button"
              className="secondary"
              data-testid="written-open"
              data-hand-press
              onClick={() => {
                onOpenInRhino(file.path);
                onDismiss(file.path);
              }}
            >
              Open in Rhino
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            data-testid="written-dismiss"
            data-hand-press
            aria-label={`Dismiss ${file.path}`}
            onClick={() => onDismiss(file.path)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A Rhino script that touched objects outside its agent's claim. It was only found out after the run (a script cannot be
 * stopped from doing it), so the card says what happened and offers the way back: the run is one undo step in Rhino.
 */
function RunReports({ reports, client }: { reports: RunReportView[]; client: AgentClient }) {
  return (
    <ul className="run-reports" data-testid="run-reports" aria-label="Scripts that went outside their claim">
      {reports.map((report) => (
        <li key={report.id} className="run-report" data-testid="run-report">
          <p className="run-report-head">
            <strong>{report.agent ? displayName(report.agent) : "A script"}</strong> touched objects outside
            its claim while running <q>{report.title}</q>. This was found after the run.
          </p>
          <ul className="run-report-list">
            {report.strays.slice(0, 5).map((stray) => (
              <li key={`${stray.what}-${stray.id}`} data-testid="run-report-stray">
                {stray.what} <code>{stray.name || stray.id}</code>
                {stray.holder ? <span className="muted"> in {stray.holder}</span> : null}
              </li>
            ))}
            {report.strays.length > 5 || report.truncated ? <li className="muted">and more</li> : null}
          </ul>
          <div className="run-report-actions">
            <button
              type="button"
              className="primary"
              data-testid="run-report-undo"
              data-hand-press
              onClick={() => client.undoRhinoRun(report.id)}
            >
              Undo in Rhino
            </button>
            <button
              type="button"
              className="secondary"
              data-testid="run-report-dismiss"
              data-hand-press
              onClick={() => client.dismissRunReport(report.id)}
            >
              Keep it
            </button>
          </div>
        </li>
      ))}
    </ul>
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
  const outcome = chipOutcome(item, approval);
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

/** What a tool call shows: its own outcome, or denied or waiting from its approval card. */
function chipOutcome(
  item: Extract<TurnItem, { kind: "tool" }>,
  approval?: ApprovalView,
): ToolOutcome | "waiting" {
  const declined = approval?.outcome === "denied" || approval?.outcome === "timed-out";
  if (declined && item.outcome !== "done") return "denied";
  if (approval && !approval.outcome && item.outcome === "running") return "waiting";
  return item.outcome;
}

/** The order the steps group reports a turn's calls in: what needs the user first, then what went wrong. */
const STEP_WEIGHT: Record<ToolOutcome | "waiting", number> = {
  waiting: 4,
  failed: 3,
  denied: 3,
  running: 2,
  done: 1,
};

/**
 * Several tool calls in a row, as one line: how many, and the one that matters most (one waiting for approval, a
 * failure, one still running). It is open while its turn runs or a call waits or failed, so nothing needing
 * attention is hidden, and folds once all is done; pressing it shows or hides every call.
 */
function StepsGroup({
  tools,
  approvalOf,
  agent,
  live,
}: {
  tools: Extract<TurnItem, { kind: "tool" }>[];
  approvalOf: (toolId: string) => ApprovalView | undefined;
  agent?: string;
  /** The turn is still running: more calls may come. */
  live: boolean;
}) {
  const outcomes = tools.map((t) => chipOutcome(t, approvalOf(t.id)));
  const worst = outcomes.reduce((a, b) => (STEP_WEIGHT[b] > STEP_WEIGHT[a] ? b : a), "done");
  const count = (o: ToolOutcome | "waiting") => outcomes.filter((x) => x === o).length;
  const waiting = tools[outcomes.indexOf("waiting")];
  let summary = `${tools.length} steps`;
  if (waiting) summary = `${toolLabel(waiting.name).tool} needs approval`;
  else if (worst === "failed" || worst === "denied")
    summary += `, ${count("failed") + count("denied")} ${worst === "denied" ? "denied" : "failed"}`;
  else if (worst === "running") summary += `, ${count("running")} running`;
  else summary += live ? " so far" : ", done";
  // Open while there is something to watch or answer, folded once all is done, unless the user chose otherwise.
  const watch = live || worst !== "done";
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? watch;
  return (
    <details
      className="agent-steps"
      data-testid="agent-steps"
      data-outcome={worst}
      open={open}
      onToggle={(e) => {
        // Only a toggle that differs from what the group shows on its own is the user's choice.
        if (e.currentTarget.open !== open) setChosen(e.currentTarget.open);
      }}
    >
      <summary className="agent-steps-head" data-hand-press>
        <span className="agent-steps-dots" aria-hidden="true">
          {outcomes.slice(0, 3).map((o, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one dot per call, in order
            <span key={i} className="tool-chip-dot" data-outcome={o} />
          ))}
        </span>
        <span className="agent-steps-summary">{summary}</span>
      </summary>
      <div className="agent-steps-list">
        {tools.map((item) => {
          const approval = approvalOf(item.id);
          return (
            <ToolChip
              key={item.id}
              item={item}
              {...(approval ? { approval } : {})}
              {...(agent ? { agent } : {})}
            />
          );
        })}
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

/**
 * Whether a turn's props are the same: arrays item by item (the panel filters them afresh on every render), anything
 * else by identity. A turn then re-renders only when its own data changes, not with every streamed word of another.
 */
function sameTurnProps<P extends object>(a: P, b: P): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof P>;
  for (const key of keys) {
    const [x, y] = [a[key], b[key]];
    if (x === y) continue;
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
    if (x.some((item, i) => item !== y[i])) return false;
  }
  return true;
}

const Turn = memo(TurnItems, sameTurnProps);

function TurnItems({
  turn,
  approvals,
  client,
  onlyPendingId,
  agent,
  team,
  onOpenTask,
  taskApprovals,
  panels,
  offers,
  taskOffers,
  onlyOfferId,
}: {
  turn: TurnView;
  approvals: ApprovalView[];
  client: AgentClient;
  onlyPendingId: string | null;
  /** The panel offers: this turn's, and every offer (for the waiting ones of the tasks this turn handed out). */
  panels: PanelClient;
  offers: OfferView[];
  taskOffers?: OfferView[];
  /** The only offer waiting for a yes or no (nod and shake decide it). */
  onlyOfferId: string | null;
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
  const offerCard = (offer: OfferView) => (
    <OfferCard key={offer.offerId} offer={offer} panels={panels} only={offer.offerId === onlyOfferId} />
  );
  // An offer belongs to the offer_panel call that made it (the n-th call, the n-th offer).
  let offered = 0;
  // Calls in a row read as one steps group; their cards and offers follow the group, where they are seen.
  type Segment =
    | { kind: "item"; index: number }
    | { kind: "steps"; tools: Extract<TurnItem, { kind: "tool" }>[] };
  const segments: Segment[] = [];
  turn.items.forEach((item, index) => {
    const last = segments.at(-1);
    if (item.kind !== "tool") segments.push({ kind: "item", index });
    else if (last?.kind === "steps") last.tools.push(item);
    else segments.push({ kind: "steps", tools: [item] });
  });
  let firstText = true;
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
      {segments.map((segment) => {
        if (segment.kind === "steps") {
          const [only] = segment.tools;
          const cards = segment.tools.flatMap((t) => {
            const approval = cardFor(t.id);
            return approval ? [card(approval)] : [];
          });
          const offerCards = segment.tools.flatMap((t) => {
            const offer = toolLabel(t.name).tool === "offer_panel" ? offers[offered++] : undefined;
            return offer ? [offerCard(offer)] : [];
          });
          const approval = only ? cardFor(only.id) : undefined;
          return (
            <div key={only?.id} className="agent-tool">
              {segment.tools.length === 1 && only ? (
                <ToolChip item={only} {...(approval ? { approval } : {})} {...(agent ? { agent } : {})} />
              ) : (
                <StepsGroup
                  tools={segment.tools}
                  approvalOf={cardFor}
                  live={!turn.ended}
                  {...(agent ? { agent } : {})}
                />
              )}
              {cards}
              {offerCards}
            </div>
          );
        }
        const item = turn.items[segment.index];
        if (item?.kind === "text") {
          const lead = firstText;
          firstText = false;
          return (
            <ReplyText
              key={segment.index}
              text={item.text}
              settled={turn.ended !== undefined}
              lead={lead && turn.kind !== "digest"}
            />
          );
        }
        if (item?.kind === "error")
          return (
            <p key={segment.index} className="agent-error" role="alert">
              {item.message}
            </p>
          );
        return null;
      })}
      {unlinked.map(card)}
      {offers.slice(offered).map(offerCard)}
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
            {taskOffers?.filter((o) => o.turnId !== null && o.turnId === task.turnId).map(offerCard)}
          </div>
        ))}
      {!turn.ended && <span className="agent-working" role="img" aria-label="Working" />}
      {turn.ended === "stopped" && (
        <p className="agent-ended">Stopped. Changes made so far are kept as one undo step.</p>
      )}
    </li>
  );
}

/**
 * Where the user's voice cut a spoken reply off (they held to talk while it was speaking): the reply stays whole in the
 * chat, and the rest can be read aloud when they have finished.
 */
function CutOffMark({ turnId, speaker }: { turnId: string; speaker: Speaker }) {
  const cut = useSyncExternalStore(speaker.subscribe, () => speaker.getSnapshot().cutOff);
  const listening = useSyncExternalStore(speaker.subscribe, () => speaker.listening);
  if (cut?.turnId !== turnId) return null;
  return (
    <li className="agent-cut" data-testid="agent-cut">
      <span className="agent-cut-note">
        Interrupted{cut.words > 0 ? ` after ${cut.words} ${cut.words === 1 ? "word" : "words"}` : ""}
      </span>
      <button
        type="button"
        className="agent-text-more"
        data-testid="agent-cut-resume"
        data-hand-press
        disabled={listening}
        onClick={() => speaker.resume()}
      >
        Read the rest aloud
      </button>
    </li>
  );
}

/** The end of the agent's latest reply, one line: what the collapsed rail can say at a glance. */
function lastReplyLine(turns: TurnView[]): string | null {
  for (const turn of [...turns].reverse()) {
    const texts = turn.items.filter((i): i is Extract<TurnItem, { kind: "text" }> => i.kind === "text");
    const text = texts.at(-1)?.text.trim();
    if (text) return clampReply(text.replace(/\s+/g, " "), 90).shown;
  }
  return null;
}

/**
 * The rail when it is collapsed: a 52 px strip. What it shows and in what order of priority is the user's choice
 * (Settings > Chat rail); `planStrip` fits that to the height the strip has.
 */
function CollapsedStrip({
  layout,
  toggle,
  statusOutput,
  title,
  toApprove,
  team,
  lastLine,
  waitingFor,
  onOpen,
  mic,
}: {
  layout: StripLayout;
  toggle: ReactNode;
  statusOutput: ReactNode;
  title: ReactNode;
  toApprove: number;
  team: TeamView | null;
  lastLine: string | null;
  /** How many requests an agent has waiting. */
  waitingFor: (agent: string) => number;
  onOpen: () => void;
  mic: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const members = team?.members.filter((m) => !m.lead) ?? [];
  const stateOf = (name: string) => (team ? memberTask(team, name).state : "idle");
  const active = (name: string) => stateOf(name) !== "idle" || waitingFor(name) > 0;
  // The chevron, the padding and the gaps are taken off what the strip has.
  const room = height - CHEVRON_ROOM;
  const { parts, alert } = planStrip(
    layout,
    {
      waiting: toApprove,
      lastLine,
      teamSize: members.length,
      teamActive: members.filter((m) => active(m.name)).length,
    },
    room,
  );
  return (
    <div className="agent-strip" ref={ref} data-alert={alert ? "true" : undefined} data-testid="agent-strip">
      {toggle}
      {parts.map((part) => {
        switch (part.kind) {
          case "waiting":
            return (
              <span key="waiting" className="agent-strip-waiting" data-loud={part.loud ? "true" : undefined}>
                <span
                  className="agent-badge"
                  data-testid="agent-pending-badge"
                  title={`${toApprove} to approve`}
                >
                  {toApprove}
                  <span className="visually-hidden"> to approve</span>
                </span>
                {part.loud && <span className="agent-strip-label">needs you</span>}
              </span>
            );
          case "state":
            return (
              <span
                key="state"
                className="agent-strip-part agent-strip-state"
                data-compact={part.compact ? "true" : undefined}
              >
                {statusOutput}
              </span>
            );
          case "name":
            return (
              <span key="name" className="agent-strip-part">
                {title}
              </span>
            );
          case "lastLine":
            return (
              <span
                key="lastLine"
                className="agent-strip-line"
                data-testid="agent-strip-line"
                title={lastLine ?? ""}
              >
                {lastLine}
              </span>
            );
          case "team":
            return (
              <span key="team" className="agent-strip-team" data-testid="agent-strip-team">
                {members
                  .filter((m) => !part.compact || active(m.name))
                  .map((m) => (
                    <button
                      key={m.name}
                      type="button"
                      className="agent-strip-member"
                      data-testid="agent-strip-member"
                      data-state={stateOf(m.name)}
                      data-hand-press
                      style={{ "--member": m.color } as CSSProperties}
                      aria-label={`${displayName(m.name)}: ${MEMBER_STATE_LABEL[stateOf(m.name)]}`}
                      title={`${displayName(m.name)}: ${MEMBER_STATE_LABEL[stateOf(m.name)]}`}
                      onClick={onOpen}
                    >
                      {displayName(m.name).charAt(0)}
                      {waitingFor(m.name) > 0 && (
                        <span className="agent-strip-pip">{waitingFor(m.name)}</span>
                      )}
                    </button>
                  ))}
              </span>
            );
          case "mic":
            return mic ? (
              <span key="mic" className="agent-strip-mic">
                {mic}
              </span>
            ) : null;
        }
        return null;
      })}
    </div>
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
 * Every specialist and its state, as one row of chips that scrolls sideways, so the conversation keeps its height.
 * With work under way each chip shows its task, its workers nest under it, and Stop all is pinned at the row's end.
 * Pressing a chip opens its task's thread.
 */
function TeamStrip({
  team,
  client,
  onOpenTask,
  approvals,
  onlyPendingId,
  selected,
}: {
  team: TeamView;
  client: AgentClient;
  onOpenTask: (taskId: string) => void;
  /** The cards waiting for the user: a worker's waits under its specialist's chip. */
  approvals: ApprovalView[];
  onlyPendingId: string | null;
  /** The agent whose thread is open: only its pictures are shown. Null while Mochi's chat is open: everyone's are. */
  selected: string | null;
}) {
  const shots = selected ? team.shots.filter((s) => baseAgent(s.agent) === baseAgent(selected)) : team.shots;
  const specialists = team.members.filter((m) => !m.lead);
  const working = team.tasks.filter(isActive).length;
  const queued = team.tasks.filter((t) => t.status === "queued").length;
  const summary = [working ? `${working} working` : "", queued ? `${queued} queued` : ""].filter(Boolean);
  const idle = summary.length === 0;
  const chips = specialists.map((member) => {
    const { state, task } = memberTask(team, member.name);
    const shown = state === "idle" ? undefined : task;
    const workers = shown ? team.tasks.filter((t) => t.parent === shown.id) : [];
    const chip = (
      <button
        key={member.name}
        type="button"
        className="team-chip"
        data-testid={`team-chip-${member.name}`}
        data-state={state}
        data-selected={selected && baseAgent(selected) === member.name ? "true" : undefined}
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
        <AgentFace name={member.name} state={state} color={member.color} />
        <span className="team-chip-name">{displayName(member.name)}</span>
        {!idle && <span className="team-chip-state">{shown ? shown.title : MEMBER_STATE_LABEL[state]}</span>}
        {!idle && shown && (shown.scope || shown.waitingFor) && (
          <span className="team-chip-scope" data-testid={`team-chip-scope-${member.name}`}>
            {state === "queued" && shown.waitingFor
              ? `waits for ${waitsFor(team, shown.waitingFor)}`
              : scopeLabel(shown.scope ?? null)}
          </span>
        )}
      </button>
    );
    return (
      <div key={member.name} className="team-member" data-workers={workers.length}>
        {chip}
        {workers.length > 0 && (
          <WorkerRows
            workers={workers}
            member={member}
            onOpenTask={onOpenTask}
            approvals={approvals}
            client={client}
            onlyPendingId={onlyPendingId}
          />
        )}
      </div>
    );
  });
  return (
    <section className="team-strip" data-testid="team-strip" data-idle={idle} aria-label="Team">
      <div className="team-row">
        <div className="team-chips" title={idle ? "All idle" : undefined}>
          {chips}
        </div>
        {!idle && (
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
      {shots.length > 0 && <ShotsStrip team={team} shots={shots} />}
      {team.claims.length > 0 && <PartsList team={team} client={client} />}
    </section>
  );
}

/** A specialist's workers, nested under its chip in its colour: title, state and what each holds. */
function WorkerRows({
  workers,
  member,
  onOpenTask,
  approvals,
  client,
  onlyPendingId,
}: {
  workers: TeamTask[];
  member: TeamMemberInfo;
  onOpenTask: (taskId: string) => void;
  approvals: ApprovalView[];
  client: AgentClient;
  onlyPendingId: string | null;
}) {
  return (
    <ul className="team-workers" data-testid={`team-workers-${member.name}`} style={colorOf(member)}>
      {workers.map((w) => (
        <li key={w.id}>
          <button
            type="button"
            className="team-worker"
            data-testid={`team-worker-${w.agent}`}
            data-state={w.status}
            data-hand-press
            title={`${displayName(w.agent)}: ${w.title} (${TASK_STATUS_LABEL[w.status]})`}
            onClick={() => onOpenTask(w.id)}
          >
            <span className="team-dot" aria-hidden="true" />
            <span className="team-worker-name">{displayName(w.agent)}</span>
            <span className="team-worker-title">{w.title}</span>
            <span className="team-worker-state" data-testid={`team-worker-state-${w.agent}`}>
              {w.waitingForSession
                ? "waits for a free session"
                : w.status === "running" && w.scope
                  ? scopeLabel(w.scope)
                  : TASK_STATUS_LABEL[w.status]}
            </span>
          </button>
          {approvals
            .filter((a) => a.request.agent === w.agent)
            .map((a) => (
              <ApprovalCard
                key={a.request.id}
                approval={a}
                client={client}
                only={a.request.id === onlyPendingId}
              />
            ))}
        </li>
      ))}
    </ul>
  );
}

/** What each agent last looked at from one of its own cameras: a thumbnail each, and the picture larger on click. */
function ShotsStrip({ team, shots }: { team: TeamView; shots: TeamShot[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const shot = shots.find((s) => s.agent === open);
  const member = (name: string) => team.members.find((m) => m.name === name);
  return (
    <>
      <div className="team-shots" data-testid="team-shots">
        {shots.map((s) => (
          <button
            key={s.agent}
            type="button"
            className="team-shot"
            data-testid={`team-shot-${s.agent}`}
            data-hand-press
            style={colorOf(member(s.agent))}
            title={`${displayName(s.agent)} looked from ${s.camera}: click to enlarge`}
            onClick={() => setOpen(s.agent)}
          >
            <img src={s.thumb} alt={`${displayName(s.agent)}'s view from ${s.camera}`} />
            <span className="team-shot-caption">
              {displayName(s.agent)} <span className="team-shot-camera">{s.camera}</span>
            </span>
          </button>
        ))}
      </div>
      {shot && <ShotDialog shot={shot} color={colorOf(member(shot.agent))} onClose={() => setOpen(null)} />}
    </>
  );
}

/** An agent's last picture, larger: the full picture while this page still has it, else the thumbnail. */
function ShotDialog({ shot, color, onClose }: { shot: TeamShot; color: CSSProperties; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const full = rememberedShot(shot.agent);
  const src = full && full.camera === shot.camera ? `data:image/png;base64,${full.png}` : shot.thumb;
  // Over the whole page: the agent panel is frosted glass, which would otherwise hold a fixed child inside itself.
  return createPortal(
    <div className="shot-dialog" role="dialog" aria-label={`${displayName(shot.agent)}'s view`} style={color}>
      <button type="button" className="shot-dialog-backdrop" aria-label="Close" onClick={onClose} />
      <figure className="shot-dialog-body" data-testid="shot-dialog">
        <img src={src} alt={`${displayName(shot.agent)}'s view from ${shot.camera}`} />
        <figcaption>
          <span className="team-dot" aria-hidden="true" />
          {displayName(shot.agent)} looked from <strong>{shot.camera}</strong>
          <button type="button" className="shot-dialog-close" data-hand-press onClick={onClose}>
            Close
          </button>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}

/** Whose task a queued task waits for, as "Architect" (or "another task" when it has ended). */
function waitsFor(team: TeamView, taskId: string): string {
  const task = team.tasks.find((t) => t.id === taskId);
  return task ? `${displayName(task.agent)}'s task` : "another task";
}

/**
 * Who is working on which part of the model: one row per running claim, in the agent's colour. Pointing at a row lights
 * its elements in the viewer.
 */
function PartsList({ team, client }: { team: TeamView; client: AgentClient }) {
  return (
    <ul className="parts-list" data-testid="parts-list" aria-label="Parts being worked on">
      {team.claims.map((claim) => {
        const member = team.members.find((m) => m.name === baseAgent(claim.agent));
        return (
          <li key={claim.taskId} className="part-row" data-worker={claim.parent ? "true" : undefined}>
            <button
              type="button"
              className="part-button"
              data-testid="part-row"
              data-claim={claim.taskId}
              data-hand-press
              style={colorOf(member)}
              onPointerEnter={() => client.highlightClaim(claim.taskId)}
              onPointerLeave={() => client.highlightClaim(null)}
              onFocus={() => client.highlightClaim(claim.taskId)}
              onBlur={() => client.highlightClaim(null)}
            >
              <span className="team-dot" aria-hidden="true" />
              <span className="part-agent">{displayName(claim.agent)}</span>
              <span className="part-title">{claim.title}</span>
              <span className="part-count">
                {claim.elements} {claim.elements === 1 ? "element" : "elements"}
              </span>
              <span className="part-scope">{scopeLabel(claim.scope)}</span>
            </button>
          </li>
        );
      })}
      {team.tasks
        .filter((t) => t.status === "queued" && t.waitingFor)
        .map((task) => (
          <li key={task.id} className="part-waiting muted" data-testid="part-waiting">
            {displayName(task.agent)} "{task.title}" waits for {waitsFor(team, task.waitingFor as string)}
          </li>
        ))}
      {team.tasks
        .filter((t) => t.status === "queued" && t.waitingForSession)
        .map((task) => (
          <li key={task.id} className="part-waiting muted" data-testid="part-waiting-session">
            {displayName(task.agent)} "{task.title}" waits for a free session ({team.sessions} of{" "}
            {team.maxSessions} are working)
          </li>
        ))}
    </ul>
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
  const member = team.members.find((m) => m.name === baseAgent(task.agent));
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
  panels,
  voice,
  startVoice,
  voiceOn = true,
  voiceNotice = null,
  nameOf,
  speaker,
  speakReplies,
  onSpeakReplies,
  strip = DEFAULT_STRIP,
  rhinoConnected = false,
  onImportFile,
  onOpenInRhino,
}: {
  client: AgentClient;
  /** The panel offers the agents make. */
  panels: PanelClient;
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
  /** What the collapsed rail shows, in what order of priority (Settings > Chat rail). */
  strip?: StripLayout;
  /** Rhino is connected: written files can be opened in it. */
  rhinoConnected?: boolean;
  /** Brings a file the agent wrote (a path in the project) into the viewer. */
  onImportFile?: (path: string) => void;
  /** Opens a file the agent wrote in Rhino. */
  onOpenInRhino?: (path: string) => void;
}) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [width, setWidth] = useState(readWidth);
  const [trayOpen, setTrayOpen] = useState(true);
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
  const { offers } = useSyncExternalStore(panels.subscribe, panels.getSnapshot);
  const waitingOffers = offers.filter((o) => o.state === "waiting");
  // A nod answers an offer only when nothing else waits for one (approval cards come first).
  const onlyOfferId =
    pending.length === 0 && waitingOffers.length === 1 ? (waitingOffers[0]?.offerId ?? null) : null;
  const toApprove = pending.length + waitingOffers.length;
  const offersOf = (turnId: string) => offers.filter((o) => o.turnId === turnId);
  const latestPlan = state.plans.at(-1);

  const setPanelCollapsed = (value: boolean) => {
    setCollapsed(value);
    writeCollapsed(value);
  };
  const setRailWidth = (px: number) => {
    setWidth(px);
    writeWidth(px);
  };
  const trayCount = (onImportFile ? state.written.length : 0) + state.runReports.length;
  // New files or reports open the tray: they wait for the user to choose.
  useEffect(() => {
    if (trayCount > 0) setTrayOpen(true);
  }, [trayCount]);

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
    const arrived = shownTurns.length > seen.current.turns || toApprove > seen.current.pending;
    seen.current = { turns: shownTurns.length, pending: toApprove };
    if (arrived || following.current) {
      el.scrollTop = el.scrollHeight;
      following.current = true;
    }
  }, [shownTurns.length, lastTurn, state.approvals, state.team, collapsed, openTask, offers]);
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

  const toggle = (
    <button
      type="button"
      className="icon-button agent-collapse"
      data-hand-press
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Show the agent panel" : "Hide the agent panel"}
      title={collapsed ? "Show the agent panel" : "Hide the agent panel"}
      onClick={() => setPanelCollapsed(!collapsed)}
    >
      <ToolIcon path={collapsed ? CHEVRON_RIGHT : CHEVRON_LEFT} size={16} />
    </button>
  );
  const statusOutput = (
    <output className="agent-status" data-testid="agent-status" data-state={status}>
      <span className="agent-dot" aria-hidden="true" />
      <span className="agent-status-label">{STATUS_LABEL[status]}</span>
    </output>
  );
  const title = (
    <span className="agent-title" data-testid="agent-title">
      {team ? displayName(client.lead) : "Agent"}
    </span>
  );

  return (
    <section
      className="agent-panel agent-rail"
      data-testid="agent-panel"
      data-collapsed={collapsed}
      data-hud
      aria-label="Agent"
      style={{ "--rail-w": `${width}px` } as CSSProperties}
    >
      {collapsed ? (
        <CollapsedStrip
          layout={strip}
          toggle={toggle}
          statusOutput={statusOutput}
          title={title}
          toApprove={toApprove}
          team={team}
          lastLine={lastReplyLine(state.turns)}
          waitingFor={(name) =>
            pending.filter((a) => a.request.agent && baseAgent(a.request.agent) === name).length
          }
          onOpen={() => setPanelCollapsed(false)}
          mic={
            voiceOn ? (
              <MicButton
                voice={voice}
                onStart={startVoice}
                disabled={status === "unavailable"}
                notice={voiceNotice}
              />
            ) : null
          }
        />
      ) : (
        <header className="agent-head">
          <div className="agent-head-row">
            {title}
            {statusOutput}
            {toggle}
          </div>
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
        </header>
      )}
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
            <TeamStrip
              team={team}
              client={client}
              onOpenTask={setOpenTask}
              approvals={pending}
              onlyPendingId={onlyPendingId}
              selected={task?.agent ?? null}
            />
          )}
          {team && !task && latestPlan && (
            <div className="plan-cards">
              {latestPlan.outcome === undefined ? (
                <PlanCard key={latestPlan.id} plan={latestPlan} team={team} client={client} />
              ) : (
                <details key={latestPlan.id} className="plan-summary" data-outcome={latestPlan.outcome}>
                  <summary className="plan-summary-head" data-hand-press>
                    <span className="plan-summary-text">{planSummary(latestPlan)}</span>
                  </summary>
                  <PlanCard plan={latestPlan} team={team} client={client} />
                </details>
              )}
            </div>
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
                  panels={panels}
                  offers={offersOf(turn.id)}
                  onlyOfferId={onlyOfferId}
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
                <Fragment key={turn.id}>
                  <Turn
                    key={turn.id}
                    turn={turn}
                    approvals={state.approvals.filter((a) => a.turnId === turn.id)}
                    client={client}
                    onlyPendingId={onlyPendingId}
                    panels={panels}
                    offers={offersOf(turn.id)}
                    onlyOfferId={onlyOfferId}
                    {...(team
                      ? {
                          agent: client.lead,
                          team,
                          onOpenTask: setOpenTask,
                          taskApprovals: state.approvals,
                          taskOffers: offers,
                        }
                      : {})}
                  />
                  <CutOffMark turnId={turn.id} speaker={speaker} />
                </Fragment>
              ))}
          </ol>
          {trayCount > 0 && (
            <div className="agent-tray" data-open={trayOpen}>
              <button
                type="button"
                className="agent-tray-toggle"
                data-testid="agent-tray-toggle"
                data-hand-press
                aria-expanded={trayOpen}
                onClick={() => setTrayOpen(!trayOpen)}
              >
                <span>Files and runs ({trayCount})</span>
                <ToolIcon path={TRAY_ICON} size={14} />
              </button>
              {trayOpen && (
                <div className="agent-tray-body">
                  {state.written.length > 0 && onImportFile && (
                    <WrittenFiles
                      files={state.written}
                      rhinoConnected={rhinoConnected}
                      onImport={onImportFile}
                      onOpenInRhino={(path) => onOpenInRhino?.(path)}
                      onDismiss={(path) => client.dismissWritten(path)}
                    />
                  )}
                  {state.runReports.length > 0 && <RunReports reports={state.runReports} client={client} />}
                </div>
              )}
            </div>
          )}
          {state.error && (
            <p className="agent-input-error" role="alert" data-testid="agent-error">
              {state.error}
            </p>
          )}
          <form className="agent-input agent-composer" onSubmit={submit}>
            <div className="agent-composer-field">
              {voiceOn && <VoiceBar voice={voice} nameOf={nameOf} />}
              <textarea
                className="agent-composer-input"
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
              <div className="agent-composer-actions">
                {voiceOn && (
                  <MicButton
                    voice={voice}
                    onStart={startVoice}
                    disabled={status === "unavailable"}
                    notice={voiceNotice}
                  />
                )}
                <SpeakToggle speaker={speaker} on={speakReplies} onChange={onSpeakReplies} />
                <span className="agent-composer-spacer" />
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
              </div>
            </div>
          </form>
        </>
      )}
      {!collapsed && <RailHandle width={width} onWidth={setRailWidth} />}
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
