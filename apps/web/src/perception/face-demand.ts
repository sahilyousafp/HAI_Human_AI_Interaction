import type { GestureAction, GestureBindings } from "@hai/protocol";

/**
 * Head tracking runs only while a nod or a shake can do something. The face model takes about a third of every
 * frame, and while it runs a hand sweeping over the face moves further between frames and is lost more often. A
 * hand over the face also throws the head pose about, and a stray "shake" cancels the tool's drag. So the face stays
 * off while you pinch, and comes on when something waits for a yes or a no.
 */
export interface FaceDemand {
  /** Settings > Features > Nod and shake. */
  headGestures: boolean;
  nod: GestureAction;
  shake: GestureAction;
  /**
   * Something a nod or a shake answers is waiting: a spoken request under review or just sent, an approval card, a
   * panel offer, or the tool's question.
   */
  answerWaiting: boolean;
}

const answers = (action: GestureAction) => action === "yes" || action === "no";

export function faceNeeded({ headGestures, nod, shake, answerWaiting }: FaceDemand): boolean {
  if (!headGestures) return false;
  // A nod or shake bound to a command (undo, cancel, ...) can act at any moment.
  const command = (action: GestureAction) => !answers(action) && action !== "none";
  if (command(nod) || command(shake)) return true;
  return answerWaiting && (answers(nod) || answers(shake));
}

type Store = { subscribe(listener: () => void): () => void };

/** The stores whose state decides `faceNeeded`. */
export interface FaceDemandSources {
  features: Store & { on(id: "headGestures"): boolean };
  bindings: Store & { getSnapshot(): GestureBindings };
  voice: Store & { readonly reviewing: boolean; readonly canStopSent: boolean };
  approvals: Store & { readonly pending: readonly unknown[] };
  offers: Store & { readonly waiting: readonly unknown[] };
  tools: Store & { getSnapshot(): { question: string | null } };
}

function faceDemand(s: FaceDemandSources): FaceDemand {
  const bindings = s.bindings.getSnapshot();
  return {
    headGestures: s.features.on("headGestures"),
    nod: bindings.nod,
    shake: bindings.shake,
    answerWaiting:
      s.voice.reviewing ||
      s.voice.canStopSent ||
      s.approvals.pending.length > 0 ||
      s.offers.waiting.length > 0 ||
      s.tools.getSnapshot().question !== null,
  };
}

/** Calls `onChange` with whether the face is needed now, and again each time that changes. Returns how to stop. */
export function watchFaceDemand(sources: FaceDemandSources, onChange: (needed: boolean) => void): () => void {
  let last: boolean | null = null;
  const check = () => {
    const needed = faceNeeded(faceDemand(sources));
    if (needed === last) return;
    last = needed;
    onChange(needed);
  };
  const stores = [
    sources.features,
    sources.bindings,
    sources.voice,
    sources.approvals,
    sources.offers,
    sources.tools,
  ];
  const unsubscribe = stores.map((store) => store.subscribe(check));
  check();
  return () => {
    for (const off of unsubscribe) off();
  };
}
