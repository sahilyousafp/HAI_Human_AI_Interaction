import type {
  Message,
  PanelDocument,
  PanelOfferState,
  PanelOutcome,
  SceneDocument,
  SceneOp,
} from "@hai/protocol";
import { applyTransaction } from "@hai/scene";

/** What the panel client needs of the scene: the committed document and selection, and applying a transaction. */
export interface PanelScene {
  getSnapshot(): { doc: SceneDocument | null; selection: string[] };
  subscribe(listener: () => void): () => void;
  apply(label: string, ops: SceneOp[]): boolean;
}

/** The frame on screen, and the way to send it a hand press in the frame's own coordinates. */
export interface PanelFrameHandle {
  element: HTMLElement;
  press(phase: "down" | "move" | "up", x: number, y: number): void;
}

/** An offer card: what the agent asked, and where it stands. */
export interface OfferView {
  offerId: string;
  purpose: string;
  agent?: string;
  state: PanelOfferState;
  /** The agent's turn that was running when the offer arrived (where its card is shown). */
  turnId: string | null;
  /** When the offer first arrived (epoch ms), for the countdown to its expiry. */
  at: number;
}

/** The panel on screen: a loading frame from the user's nod until the agent's document is in place. */
export interface PanelView {
  /** Null while only the loading frame exists (the agent has not supplied the document yet). */
  panelId: string | null;
  offerId: string;
  agent?: string;
  /** An information panel (its agent does not change the model): it shows, and cannot preview or commit. */
  readOnly?: boolean;
  document: PanelDocument | null;
  status: "loading" | "ready" | "failed";
  reason?: string;
  /** Counts replaced documents, so the frame reloads for each. */
  revision: number;
}

export interface PanelState {
  /** Recent offers, oldest first. */
  offers: OfferView[];
  panel: PanelView | null;
  /** Counts preview rebuilds, so the viewer redraws once per frame. */
  previewVersion: number;
}

const OFFERS_KEPT = 20;
const INITIAL: PanelState = { offers: [], panel: null, previewVersion: 0 };
const newId = () => crypto.randomUUID();

export interface PanelClientOptions {
  send(message: Message): boolean;
  scene: PanelScene;
  /** The id of the turn an agent is running now (where its offer card belongs). */
  runningTurn(agent?: string): string | null;
  /** Runs `work` before the next frame is drawn (requestAnimationFrame). */
  frame?(work: () => void): void;
}

/**
 * The browser's side of generated panels: the offers the agent made, the one panel that may be open, and the preview
 * its controls make. A preview lives only here: the viewer shows the scene as if its operations were applied, and
 * neither the bridge, the undo history, the project nor the agent sees it until Done (or the panel's own commit)
 * sends it as one transaction.
 */
export class PanelClient {
  private state = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly problemListeners = new Set<(message: string) => void>();
  /** The preview's operations as the panel last sent them (replaced as a whole by every preview); a commit sends these. */
  private ops: SceneOp[] = [];
  /** The operations the viewer shows: `ops` as of the last drawn frame. */
  private shown: SceneOp[] = [];
  /** The scene document the current preview was last applied to, and the result. */
  private built: { base: SceneDocument; ops: SceneOp[]; doc: SceneDocument } | null = null;
  private frameQueued = false;
  /** A commit was sent: the preview ends when the committed change arrives. */
  private committed = false;
  /** The open panel's frame and the host of its port: where hand presses over the frame go. */
  private frameHandle: PanelFrameHandle | null = null;
  /** Offers whose loading frame the user closed before the document arrived. */
  private readonly dismissed = new Set<string>();

  constructor(private readonly options: PanelClientOptions) {
    // The preview is laid over every new scene, and dropped when it no longer applies.
    let previous = options.scene.getSnapshot().doc;
    options.scene.subscribe(() => {
      const doc = options.scene.getSnapshot().doc;
      if (doc === previous) return;
      previous = doc;
      if (this.committed && this.ops.length > 0) {
        this.committed = false;
        this.ops = [];
        this.shown = [];
        this.built = null;
        this.bump();
        return;
      }
      if (this.shown.length > 0) this.rebuild();
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PanelState => this.state;

  /** Told when the panel's operations were rejected or its preview was dropped (the panel shows it to its script). */
  onProblem = (listener: (message: string) => void): (() => void) => {
    this.problemListeners.add(listener);
    return () => this.problemListeners.delete(listener);
  };

  /** The frame hand presses go to, once the panel's document has loaded. */
  get frame(): PanelFrameHandle | null {
    return this.frameHandle;
  }

  setFrame(handle: PanelFrameHandle | null): void {
    this.frameHandle = handle;
  }

  /** Offers waiting for the user's answer, oldest first. */
  get waiting(): OfferView[] {
    return this.state.offers.filter((o) => o.state === "waiting");
  }

  /** Whether the panel has a preview. */
  get previewing(): boolean {
    return this.ops.length > 0;
  }

  /** The preview's operations (for tests and the commit). */
  get previewOps(): readonly SceneOp[] {
    return this.ops;
  }

  /** The document the viewer draws: the scene with the panel's preview applied over it. */
  shownDoc(doc: SceneDocument | null): SceneDocument | null {
    if (!doc || this.shown.length === 0) return doc;
    if (this.built?.base === doc && this.built.ops === this.shown) return this.built.doc;
    const result = applyTransaction(doc, this.shown);
    if (!result.ok) return doc; // rebuild() drops it and says why
    this.built = { base: doc, ops: this.shown, doc: result.doc };
    return result.doc;
  }

  /** Handles a bridge message; returns false if it was not about panels. */
  handle(message: Message): boolean {
    switch (message.type) {
      case "panel.offer": {
        const { offerId, purpose, state, agent } = message.payload;
        const known = this.state.offers.find((o) => o.offerId === offerId);
        const offer: OfferView = {
          offerId,
          purpose,
          state,
          turnId: known?.turnId ?? this.options.runningTurn(agent),
          at: known?.at ?? Date.now(),
          ...(agent ? { agent } : {}),
        };
        const offers = known
          ? this.state.offers.map((o) => (o.offerId === offerId ? offer : o))
          : [...this.state.offers, offer].slice(-OFFERS_KEPT);
        this.update({ offers });
        if (state === "accepted") this.showLoadingFrame(offer);
        else if (state !== "waiting") this.dropLoadingFrame(offerId);
        return true;
      }
      case "panel.open": {
        const { panelId, offerId, agent, readOnly, title, width, height, html } = message.payload;
        if (this.dismissed.delete(offerId)) {
          // The user closed the loading frame: the document never shows.
          this.options.send({
            type: "panel.closed",
            id: newId(),
            payload: { panelId, outcome: "discarded" },
          });
          return true;
        }
        const previous = this.state.panel;
        this.endPreview();
        this.update({
          panel: {
            panelId,
            offerId,
            document: { title, width, height, html },
            status: "loading",
            revision: (previous?.revision ?? 0) + 1,
            ...(agent ? { agent } : {}),
            ...(readOnly ? { readOnly: true } : {}),
          },
        });
        return true;
      }
      case "panel.update": {
        const { panelId, title, width, height, html } = message.payload;
        const panel = this.state.panel;
        if (!panel || panel.panelId !== panelId) return true;
        this.endPreview();
        this.update({
          panel: {
            ...panel,
            document: { title, width, height, html },
            status: "loading",
            revision: panel.revision + 1,
          },
        });
        return true;
      }
      case "panel.close": {
        if (this.state.panel?.panelId === message.payload.panelId) this.reset();
        return true;
      }
      default:
        return false;
    }
  }

  /** The user answers an offer: Open (accepted) shows the frame at once, Skip (skipped) tells the agent. */
  answer(offerId: string, accepted: boolean): boolean {
    const offer = this.state.offers.find((o) => o.offerId === offerId);
    if (offer?.state !== "waiting") return false;
    const sent = this.options.send({
      type: "panel.offer.answer",
      id: newId(),
      payload: { offerId, answer: accepted ? "accepted" : "skipped" },
    });
    if (!sent) return false;
    const state = accepted ? "accepted" : "skipped";
    this.update({ offers: this.state.offers.map((o) => (o.offerId === offerId ? { ...o, state } : o)) });
    if (accepted) this.showLoadingFrame({ ...offer, state });
    return true;
  }

  /**
   * A gesture's "yes" or "no" (a nod and a shake) for the offer when exactly one waits. Opening needs the user to be
   * engaged, so a stray nod never opens a panel. Returns whether there was exactly one offer to answer.
   */
  answerOnly(yes: boolean, engaged: boolean): boolean {
    const [only, ...more] = this.waiting;
    if (!only || more.length > 0 || (yes && !engaged)) return false;
    return this.answer(only.offerId, yes);
  }

  /** The frame's document loaded (or threw): the agent's open_panel call is waiting to hear which. */
  loaded(panelId: string, ok: boolean, reason?: string): void {
    const panel = this.state.panel;
    if (!panel || panel.panelId !== panelId) return;
    this.options.send({
      type: "panel.status",
      id: newId(),
      payload: { panelId, state: ok ? "ready" : "failed", ...(reason ? { reason } : {}) },
    });
    this.update({
      panel: { ...panel, status: ok ? "ready" : "failed", ...(reason ? { reason } : {}) },
    });
  }

  /** The panel's script threw after it loaded: the header shows it, and the agent is told. */
  failed(panelId: string, reason: string): void {
    const panel = this.state.panel;
    if (!panel || panel.panelId !== panelId || panel.status === "failed") return;
    this.loaded(panelId, false, reason);
  }

  /** Replaces the preview with these operations (empty clears it); the viewer redraws once per frame. */
  setPreview(ops: SceneOp[]): void {
    const panel = this.state.panel;
    if (!panel?.panelId) return;
    if (panel.readOnly && ops.length > 0) {
      this.refuse(panel.panelId, "preview");
      return;
    }
    this.ops = ops;
    this.committed = false;
    if (this.frameQueued) return;
    this.frameQueued = true;
    (this.options.frame ?? ((work) => requestAnimationFrame(work)))(() => {
      this.frameQueued = false;
      this.shown = this.ops;
      this.rebuild();
    });
  }

  /** Keeps the preview as one undo step labelled with the panel's title, and leaves the panel open. */
  commit(): boolean {
    const panel = this.state.panel;
    if (panel?.readOnly) {
      if (panel.panelId) this.refuse(panel.panelId, "commit");
      return false;
    }
    const title = panel?.document?.title;
    if (!title || this.ops.length === 0) return false;
    const sent = this.options.scene.apply(title.slice(0, 120), this.ops);
    // The preview stays until the committed change arrives, so the model does not flick back meanwhile.
    this.committed = sent;
    return sent;
  }

  /** Done: keeps the result as one undo step and closes the panel (an information panel only closes). */
  done(): void {
    if (this.state.panel?.readOnly) {
      this.close();
      return;
    }
    this.commit();
    this.finish("kept");
  }

  /** An information panel tried to change the model: nothing happens, its script is told, the agent hears at close. */
  private refuse(panelId: string, attempt: "preview" | "commit"): void {
    this.options.send({ type: "panel.refused", id: newId(), payload: { panelId, attempt } });
    for (const listener of this.problemListeners)
      listener("This panel is information only: it cannot change the model, so nothing was changed.");
  }

  /** Close: puts the model back as it was at the panel's last commit. */
  close(): void {
    this.finish("discarded");
  }

  /** The panel goes away without a word to the bridge: the connection is lost, or the feature was switched off. */
  reset(): void {
    this.endPreview();
    if (this.state.panel) this.update({ panel: null });
  }

  private finish(outcome: PanelOutcome): void {
    const panel = this.state.panel;
    if (!panel) return;
    if (panel.panelId) {
      this.options.send({ type: "panel.closed", id: newId(), payload: { panelId: panel.panelId, outcome } });
      this.dismissed.delete(panel.offerId);
    } else {
      // Still the loading frame: the document that follows the nod is not shown.
      this.dismissed.add(panel.offerId);
    }
    // Done keeps the preview showing until the committed change arrives; Close puts the model back at once.
    if (outcome === "discarded" || !this.committed) this.endPreview();
    this.update({ panel: null });
  }

  private endPreview(): void {
    this.committed = false;
    if (this.ops.length === 0 && this.shown.length === 0) return;
    this.ops = [];
    this.shown = [];
    this.built = null;
    this.bump();
  }

  private showLoadingFrame(offer: OfferView): void {
    if (this.state.panel) return;
    if (this.dismissed.has(offer.offerId)) return;
    this.update({
      panel: {
        panelId: null,
        offerId: offer.offerId,
        document: null,
        status: "loading",
        revision: 0,
        ...(offer.agent ? { agent: offer.agent } : {}),
      },
    });
  }

  /** The offer ended without a panel ("No panel was made", skipped, expired): its loading frame goes. */
  private dropLoadingFrame(offerId: string): void {
    const panel = this.state.panel;
    if (panel && panel.panelId === null && panel.offerId === offerId) this.update({ panel: null });
    this.dismissed.delete(offerId);
  }

  /** Applies the preview to the current scene once; a preview that no longer applies is dropped and reported. */
  private rebuild(): void {
    const doc = this.options.scene.getSnapshot().doc;
    if (!doc || this.shown.length === 0) {
      this.built = null;
      this.bump();
      return;
    }
    const result = applyTransaction(doc, this.shown);
    if (!result.ok) {
      this.ops = [];
      this.shown = [];
      this.built = null;
      this.bump();
      for (const listener of this.problemListeners) listener(result.error);
      return;
    }
    this.built = { base: doc, ops: this.shown, doc: result.doc };
    this.bump();
  }

  private bump(): void {
    this.update({ previewVersion: this.state.previewVersion + 1 });
  }

  private update(partial: Partial<PanelState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }
}
