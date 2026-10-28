import type { Point3Mm } from "@hai/protocol";
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useState } from "react";
import { MM } from "./geometry.ts";

/** A permission request an agent is waiting on, as the model shows it: a pulsing badge on the element it concerns. */
export interface ApprovalBadge {
  /** The request's id. */
  id: string;
  agent: string | null;
  /** The agent's name as shown, and its first letter for the badge. */
  agentName: string;
  color: string;
  /** What is asked: "Allow update_elements?". */
  question: string;
  /** A short account of the call. */
  summary: string;
  installs: string[];
  /** Where it sits: the top middle of what the request concerns, millimetres. */
  point: Point3Mm;
  /** It runs a script: the full card in the chat decides it, so the script is read first. */
  review: boolean;
  /** The only request waiting: a nod allows it and a shake denies it. */
  nod: boolean;
}

const SUMMARY_MAX = 90;

/** Stacks of badges that share a place sit side by side, so none hides another. */
const placeKey = (p: Point3Mm) => p.map((v) => Math.round(v / 500)).join(",");

function Group({
  badges,
  onDecide,
  onReview,
}: {
  badges: ApprovalBadge[];
  onDecide(id: string, decision: "allow" | "deny"): void;
  onReview(): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const opened = badges.find((b) => b.id === open);
  const first = badges[0] as ApprovalBadge;
  return (
    <Html
      position={[first.point[0] * MM, first.point[1] * MM, first.point[2] * MM]}
      center
      zIndexRange={[30, 0]}
      style={{ pointerEvents: "none" }}
    >
      <div className="approval-pins" data-testid="approval-pins">
        <div className="approval-pin-row">
          {badges.map((badge) => (
            <button
              key={badge.id}
              type="button"
              className="approval-badge"
              data-testid="approval-badge"
              data-agent={badge.agent ?? ""}
              data-open={badge.id === open ? "true" : undefined}
              data-hand-press
              style={{ "--agent": badge.color } as React.CSSProperties}
              aria-label={`${badge.agentName} asks: ${badge.question}`}
              aria-expanded={badge.id === open}
              onClick={() => setOpen(badge.id === open ? null : badge.id)}
            >
              {badge.agentName.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>
        {opened && (
          <div
            className="approval-tag"
            data-testid="approval-tag"
            style={{ "--agent": opened.color } as React.CSSProperties}
          >
            <span className="approval-tag-agent">{opened.agentName}</span>
            <strong>{opened.question}</strong>
            <span className="approval-tag-summary">
              {opened.summary.length > SUMMARY_MAX
                ? `${opened.summary.slice(0, SUMMARY_MAX - 1)}…`
                : opened.summary}
            </span>
            {opened.installs.length > 0 && (
              <span className="approval-tag-installs">Installs: {opened.installs.join(", ")}</span>
            )}
            {opened.review ? (
              <div className="approval-tag-actions">
                <span className="approval-tag-note">Runs a script. Read it in the chat first.</span>
                <button type="button" className="secondary" data-hand-press onClick={onReview}>
                  Show it in the chat
                </button>
              </div>
            ) : (
              <div className="approval-tag-actions">
                <button
                  type="button"
                  className="primary"
                  data-testid="approval-tag-allow"
                  data-hand-press
                  onClick={() => onDecide(opened.id, "allow")}
                >
                  Allow
                </button>
                <button
                  type="button"
                  className="secondary"
                  data-testid="approval-tag-deny"
                  data-hand-press
                  onClick={() => onDecide(opened.id, "deny")}
                >
                  Deny
                </button>
              </div>
            )}
            {opened.nod && <span className="approval-tag-note">Or nod to allow, shake to deny.</span>}
          </div>
        )}
      </div>
    </Html>
  );
}

/**
 * The requests agents are waiting on, as pulsing badges over what they concern. A pinch on a badge opens the request next
 * to it. A request that runs a script keeps its decision in the chat card, where the whole script can be read.
 */
export function ApprovalBadges({
  badges,
  onDecide,
  onReview,
}: {
  badges: ApprovalBadge[];
  onDecide(id: string, decision: "allow" | "deny"): void;
  onReview(): void;
}) {
  // drei's Html needs the canvas's events connected and one frame drawn before it can be mounted safely.
  const connected = useThree((state) => state.events.connected);
  const [drawn, setDrawn] = useState(false);
  useFrame(() => {
    if (!drawn) setDrawn(true);
  });
  if (!connected || !drawn || badges.length === 0) return null;
  const groups = new Map<string, ApprovalBadge[]>();
  for (const badge of badges)
    groups.set(placeKey(badge.point), [...(groups.get(placeKey(badge.point)) ?? []), badge]);
  return (
    <group>
      {[...groups].map(([key, group]) => (
        <Group key={key} badges={group} onDecide={onDecide} onReview={onReview} />
      ))}
    </group>
  );
}
