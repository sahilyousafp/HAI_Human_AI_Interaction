import { randomUUID } from "node:crypto";
import { type Message, PLAN_TIMEOUT_MS, type PlanOutcome, type PlanPart } from "@hai/protocol";
import type { Logger } from "../log.ts";

type Send = (message: Message) => void;

export interface PlanBrokerOptions {
  timeoutMs?: number;
  log?: Logger;
}

interface Pending {
  id: string;
  agent: string | null;
  parts: PlanPart[];
  expiresAt: number;
  settle(outcome: PlanOutcome, keep: string[]): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * How Mochi checks a split with the user before it hands any part out. Mochi shows the parts (who does what, where),
 * the user removes the ones they do not want and confirms, or skips the plan; Mochi gets the parts that were kept and
 * hands out only those. One plan is open at a time, and an unanswered one expires.
 */
export class PlanBroker {
  private pending: Pending | null = null;

  constructor(
    private readonly options: PlanBrokerOptions,
    private readonly broadcast: Send,
  ) {}

  /** Whether a plan waits for the user (for tests). */
  get waiting(): boolean {
    return this.pending !== null;
  }

  /** Shows a plan; resolves when the user answers, it expires, or the agent's turn ends. */
  ask(
    agent: string | null,
    parts: Array<Omit<PlanPart, "id">>,
  ): Promise<{ outcome: PlanOutcome; keep: PlanPart[] }> {
    if (this.pending) {
      return Promise.resolve({ outcome: "expired" as const, keep: [] });
    }
    const timeoutMs = this.options.timeoutMs ?? PLAN_TIMEOUT_MS;
    const shown = parts.map((part) => ({ ...part, id: randomUUID() }));
    return new Promise((resolve) => {
      const pending: Pending = {
        id: randomUUID(),
        agent,
        parts: shown,
        expiresAt: Date.now() + timeoutMs,
        settle: (outcome, keep) => {
          clearTimeout(pending.timer);
          if (this.pending === pending) this.pending = null;
          this.broadcast({
            type: "plan.resolved",
            id: randomUUID(),
            payload: { id: pending.id, outcome, keep },
          });
          this.options.log?.info("plan answered", { outcome, kept: keep.length, of: shown.length });
          resolve({ outcome, keep: shown.filter((p) => keep.includes(p.id)) });
        },
        timer: setTimeout(() => pending.settle("expired", []), timeoutMs),
      };
      pending.timer.unref?.();
      this.pending = pending;
      this.broadcast(this.message(pending));
    });
  }

  /** Handles the user's answer. Returns false for other messages. */
  handle(message: Message): boolean {
    if (message.type !== "plan.answer") return false;
    const pending = this.pending;
    if (!pending || pending.id !== message.payload.id) return true; // answered already (another page), or expired
    const { keep } = message.payload;
    if (keep === null) {
      pending.settle("skipped", []);
      return true;
    }
    const known = new Set(pending.parts.map((p) => p.id));
    const kept = keep.filter((id) => known.has(id));
    // Keeping nothing is skipping the plan.
    pending.settle(kept.length > 0 ? "confirmed" : "skipped", kept);
    return true;
  }

  /** Tells a page that connects later what waits. */
  greet(send: Send): void {
    if (this.pending) send(this.message(this.pending));
  }

  /** The agent's turn ended or was stopped: its plan is over. */
  turnEnded(agent: string | null): void {
    if (this.pending && this.pending.agent === agent) this.pending.settle("expired", []);
  }

  /** Every page is gone: nobody can answer. */
  clientsGone(): void {
    this.pending?.settle("expired", []);
  }

  private message(pending: Pending): Message {
    return {
      type: "plan.pending",
      id: randomUUID(),
      payload: {
        id: pending.id,
        parts: pending.parts,
        ...(pending.agent ? { agent: pending.agent } : {}),
        expiresAt: pending.expiresAt,
      },
    };
  }
}
