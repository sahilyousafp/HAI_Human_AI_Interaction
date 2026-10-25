import { randomUUID } from "node:crypto";
import {
  type Message,
  PANEL_OFFER_TIMEOUT_MS,
  PanelDocument,
  type PanelOfferState,
  type PanelOutcome,
} from "@hai/protocol";
import type { Logger } from "../log.ts";

type Send = (message: Message) => void;

/** What the agent is told when an offer is answered. */
export type OfferAnswer = "accepted" | "skipped" | "expired";

export type PanelResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** How many offers may wait behind the open panel or offer, and for how long each waits for its turn. */
export const PANEL_QUEUE_MAX = 2;
export const PANEL_QUEUE_WAIT_MS = 60_000;

/** A panel that ended: who opened it, what it was called and whether its result was kept. */
export interface PanelClosure {
  agent: string | null;
  title: string;
  outcome: PanelOutcome;
  /** Who ended it: the user (Done, Close, Escape), the agent, or the system (connection lost, switched off). */
  by: "user" | "agent" | "system";
}

/** open_panel and update_panel give up waiting for the page to report the document loaded after this long. */
export const PANEL_LOAD_TIMEOUT_MS = 10_000;

export interface PanelBrokerOptions {
  timeoutMs?: number;
  /** How long an offer may wait for the open panel to close before it expires. */
  queueWaitMs?: number;
  loadTimeoutMs?: number;
  /** A panel ended; the bridge tells the agent that opened it. */
  closed?(closure: PanelClosure): void;
  log?: Logger;
}

/** The one offer or panel that exists at a time, across all agents. */
interface Slot {
  agent: string | null;
  offerId: string;
  purpose: string;
  /** The per-agent state machine: waiting -> accepted -> open; none is the absence of a slot. */
  state: "waiting" | "accepted" | "open";
  panelId?: string;
  document?: PanelDocument;
  /** Settles the agent's offer_panel call. */
  answer?(answer: OfferAnswer): void;
  timer?: ReturnType<typeof setTimeout>;
  /** Settles the agent's open_panel call once the page reports the document loaded or failed. */
  loaded?(result: PanelResult): void;
  loadTimer?: ReturnType<typeof setTimeout>;
}

/** An offer waiting for the open panel or offer to end: only one agent's at a time is shown to the user. */
interface Queued {
  agent: string | null;
  purpose: string;
  queuedAt: number;
  /** Settles the agent's offer_panel call. */
  resolve(result: PanelResult<{ answer: OfferAnswer; waitedMs: number }>): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Decides when a generated panel may exist. The agent offers, the user answers, and only an accepted offer allows
 * one panel to be supplied; one offer or panel is shown at a time, and an offer made meanwhile waits its turn (at most two wait, for at most a
 * minute each; the offering agent's call returns when it is answered or has expired). The state of each agent is
 * `none -> waiting -> accepted -> open -> none`, and every refusal says what to do instead.
 */
export class PanelBroker {
  private slot: Slot | null = null;
  private queue: Queued[] = [];

  constructor(
    private readonly options: PanelBrokerOptions,
    private readonly broadcast: Send,
  ) {}

  /** The state of one agent's offer: `none` when it has nothing waiting, accepted or open. */
  stateOf(agent: string | null): "none" | "waiting" | "accepted" | "open" {
    return this.slot && this.slot.agent === agent ? this.slot.state : "none";
  }

  /** Whether any offer or panel exists (for tests and the interface's mirror). */
  get active(): boolean {
    return this.slot !== null;
  }

  /**
   * The agent offers a panel: resolves when the user answers, or after a minute. While another panel or offer is
   * shown, the offer waits behind it (the agent's call waits too, and is told how long it waited); a third waiting
   * offer, or a second one from the same agent, is refused.
   */
  offer(
    agent: string | null,
    purpose: string,
  ): Promise<PanelResult<{ answer: OfferAnswer; waitedMs: number }>> {
    const busy = this.slot;
    if (busy) {
      if (busy.agent === agent) {
        return Promise.resolve({
          ok: false,
          error:
            busy.state === "open"
              ? "A panel of yours is already open. Replace it with update_panel, or close it first."
              : "Your offer is already waiting for the user's answer.",
        });
      }
      if (this.queue.some((q) => q.agent === agent)) {
        return Promise.resolve({
          ok: false,
          error: "An offer of yours is already waiting for its turn. Carry on in chat meanwhile.",
        });
      }
      if (this.queue.length >= PANEL_QUEUE_MAX) {
        return Promise.resolve({
          ok: false,
          error: `${PANEL_QUEUE_MAX} offers are already waiting behind the open panel. Carry on in chat instead.`,
        });
      }
      return new Promise((resolve) => {
        const entry: Queued = {
          agent,
          purpose,
          queuedAt: Date.now(),
          resolve,
          timer: setTimeout(() => this.expireQueued(entry), this.options.queueWaitMs ?? PANEL_QUEUE_WAIT_MS),
        };
        entry.timer.unref?.();
        this.queue.push(entry);
        this.options.log?.info("panel offer waits", {
          ...(agent ? { agent } : {}),
          waiting: this.queue.length,
        });
      });
    }
    return new Promise((resolve) => this.show(agent, purpose, 0, resolve));
  }

  /** Shows an offer to the user: it is the one offer or panel now. */
  private show(
    agent: string | null,
    purpose: string,
    waitedMs: number,
    resolve: (result: PanelResult<{ answer: OfferAnswer; waitedMs: number }>) => void,
  ): void {
    const timeoutMs = this.options.timeoutMs ?? PANEL_OFFER_TIMEOUT_MS;
    const slot: Slot = {
      agent,
      offerId: randomUUID(),
      purpose,
      state: "waiting",
      answer: (answer) => resolve({ ok: true, answer, waitedMs }),
    };
    slot.timer = setTimeout(() => this.answerOffer(slot, "expired"), timeoutMs);
    slot.timer.unref?.();
    this.slot = slot;
    this.sendOffer(slot, "waiting");
  }

  /** The offer or panel in the way has ended: the next waiting offer is shown. */
  private promote(): void {
    if (this.slot) return;
    const next = this.queue.shift();
    if (!next) return;
    clearTimeout(next.timer);
    this.show(next.agent, next.purpose, Date.now() - next.queuedAt, next.resolve);
  }

  /** A waiting offer ran out of patience: its agent is told it expired, and the user never saw it. */
  private expireQueued(entry: Queued): void {
    this.queue = this.queue.filter((q) => q !== entry);
    clearTimeout(entry.timer);
    entry.resolve({ ok: true, answer: "expired", waitedMs: Date.now() - entry.queuedAt });
  }

  /** Every waiting offer (of one agent, or of all) is over without having been shown. */
  private dropQueued(agent?: string | null): void {
    for (const entry of this.queue.filter((q) => agent === undefined || q.agent === agent))
      this.expireQueued(entry);
  }

  /**
   * The agent supplies the panel. Refused unless the user accepted an offer of this agent that no panel has used.
   * Resolves when the page has loaded the document (ready) or failed to.
   */
  open(agent: string | null, document: PanelDocument): Promise<PanelResult> {
    const slot = this.slot;
    if (slot?.agent === agent && slot.state === "open") {
      return Promise.resolve({
        ok: false,
        error: "A panel is already open. Replace it with update_panel, or close it first.",
      });
    }
    if (!slot || slot.agent !== agent || slot.state !== "accepted") {
      return Promise.resolve({
        ok: false,
        error: "The user has not accepted a panel. Call offer_panel first and wait for the user to open it.",
      });
    }
    slot.state = "open";
    slot.panelId = randomUUID();
    slot.document = document;
    this.broadcast({
      type: "panel.open",
      id: randomUUID(),
      payload: { panelId: slot.panelId, offerId: slot.offerId, ...(agent ? { agent } : {}), ...document },
    });
    return this.awaitLoad(slot);
  }

  /** The agent replaces the open panel's document. Resolves when the page has loaded the new one. */
  update(agent: string | null, patch: Partial<PanelDocument>): Promise<PanelResult> {
    const slot = this.slot;
    if (!slot || slot.agent !== agent || slot.state !== "open" || !slot.panelId || !slot.document) {
      return Promise.resolve({
        ok: false,
        error: "No panel is open. Call open_panel after the user accepts.",
      });
    }
    const document = PanelDocument.safeParse({ ...slot.document, ...patch });
    if (!document.success) {
      return Promise.resolve({ ok: false, error: `The panel was not updated. ${document.error.message}` });
    }
    slot.document = document.data;
    this.broadcast({
      type: "panel.update",
      id: randomUUID(),
      payload: { panelId: slot.panelId, ...document.data },
    });
    return this.awaitLoad(slot);
  }

  /** The agent closes its panel; any uncommitted preview is discarded. */
  close(agent: string | null): PanelResult {
    const slot = this.slot;
    if (!slot || slot.agent !== agent || slot.state !== "open" || !slot.panelId) {
      return { ok: false, error: "No panel is open." };
    }
    this.broadcast({
      type: "panel.close",
      id: randomUUID(),
      payload: { panelId: slot.panelId, reason: "agent" },
    });
    this.finish(slot, "discarded", "agent");
    return { ok: true };
  }

  /** Handles a panel message from a client. Returns false for other messages. */
  handle(message: Message): boolean {
    switch (message.type) {
      case "panel.offer.answer": {
        const slot = this.slot;
        // Already answered (another client, or it expired): nothing to do.
        if (slot?.state === "waiting" && slot.offerId === message.payload.offerId) {
          this.answerOffer(slot, message.payload.answer);
        }
        return true;
      }
      case "panel.status": {
        const slot = this.slot;
        if (slot?.panelId === message.payload.panelId) {
          const { state, reason } = message.payload;
          this.settleLoad(
            slot,
            state === "ready" ? { ok: true } : { ok: false, error: reason ?? "The panel failed to load." },
          );
        }
        return true;
      }
      case "panel.closed": {
        const slot = this.slot;
        if (slot?.panelId === message.payload.panelId) this.finish(slot, message.payload.outcome, "user");
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * A turn of this agent ended or was stopped. An offer that nobody answered, or an accepted offer the agent never
   * used, is over. An open panel stays: it outlives the turn that made it.
   */
  turnEnded(agent: string | null): void {
    this.dropQueued(agent);
    const slot = this.slot;
    if (!slot || slot.agent !== agent || slot.state === "open") return;
    if (slot.state === "waiting") this.answerOffer(slot, "expired", "unused");
    else this.clearSlot(slot, "unused");
  }

  /** The Generated panels feature was switched off: an open panel closes, an offer is withdrawn. */
  switchedOff(): void {
    this.dropQueued();
    const slot = this.slot;
    if (!slot) return;
    if (slot.state === "open" && slot.panelId) {
      this.broadcast({
        type: "panel.close",
        id: randomUUID(),
        payload: { panelId: slot.panelId, reason: "switched-off" },
      });
      this.finish(slot, "discarded", "system");
    } else if (slot.state === "waiting") this.answerOffer(slot, "expired", "unused");
    else this.clearSlot(slot, "unused");
  }

  /** Every page is gone: nothing can show or answer a panel, so the offer or panel is over. */
  clientsGone(): void {
    this.dropQueued();
    const slot = this.slot;
    if (!slot) return;
    if (slot.state === "open") this.finish(slot, "discarded", "system");
    else if (slot.state === "waiting") this.answerOffer(slot, "expired", "unused");
    else this.clearSlot(slot, "unused");
  }

  /** Tells a page that connects later what is waiting or open. */
  greet(send: Send): void {
    const slot = this.slot;
    if (!slot) return;
    if (slot.state === "open" && slot.panelId && slot.document) {
      send({
        type: "panel.open",
        id: randomUUID(),
        payload: {
          panelId: slot.panelId,
          offerId: slot.offerId,
          ...(slot.agent ? { agent: slot.agent } : {}),
          ...slot.document,
        },
      });
    } else this.sendOffer(slot, slot.state === "waiting" ? "waiting" : "accepted", send);
  }

  private answerOffer(slot: Slot, answer: OfferAnswer, shown?: PanelOfferState): void {
    if (this.slot !== slot || slot.state !== "waiting") return;
    clearTimeout(slot.timer);
    this.options.log?.info("panel offer", { answer, ...(slot.agent ? { agent: slot.agent } : {}) });
    slot.answer?.(answer);
    slot.answer = undefined;
    if (answer === "accepted") {
      slot.state = "accepted";
      this.sendOffer(slot, "accepted");
    } else {
      this.clearSlot(slot, shown ?? answer);
    }
  }

  /** The slot ends without a panel: tell clients what the card should now say. */
  private clearSlot(slot: Slot, shown: PanelOfferState): void {
    if (this.slot !== slot) return;
    clearTimeout(slot.timer);
    this.slot = null;
    this.sendOffer(slot, shown);
    this.promote();
  }

  private finish(slot: Slot, outcome: PanelOutcome, by: PanelClosure["by"]): void {
    if (this.slot !== slot) return;
    this.slot = null;
    this.settleLoad(slot, { ok: false, error: "The panel was closed before it loaded." });
    this.options.log?.info("panel closed", { outcome, by, ...(slot.agent ? { agent: slot.agent } : {}) });
    this.options.closed?.({ agent: slot.agent, title: slot.document?.title ?? slot.purpose, outcome, by });
    this.promote();
  }

  private awaitLoad(slot: Slot): Promise<PanelResult> {
    // A newer document replaces one still loading: the earlier call is told it was superseded.
    this.settleLoad(slot, { ok: false, error: "The panel was replaced before it loaded." });
    return new Promise((resolve) => {
      slot.loaded = resolve;
      slot.loadTimer = setTimeout(
        () => this.settleLoad(slot, { ok: false, error: "The page did not report the panel as loaded." }),
        this.options.loadTimeoutMs ?? PANEL_LOAD_TIMEOUT_MS,
      );
      slot.loadTimer.unref?.();
    });
  }

  private settleLoad(slot: Slot, result: PanelResult): void {
    clearTimeout(slot.loadTimer);
    const settle = slot.loaded;
    slot.loaded = undefined;
    settle?.(result);
  }

  private sendOffer(slot: Slot, state: PanelOfferState, send: Send = this.broadcast): void {
    send({
      type: "panel.offer",
      id: randomUUID(),
      payload: {
        offerId: slot.offerId,
        purpose: slot.purpose,
        state,
        ...(slot.agent ? { agent: slot.agent } : {}),
      },
    });
  }
}
