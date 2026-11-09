import { DEFAULT_BINDINGS, type GestureBindings } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { type FaceDemandSources, faceNeeded, watchFaceDemand } from "./face-demand.ts";

const base = { headGestures: true, nod: "yes", shake: "no", answerWaiting: false } as const;

describe("faceNeeded", () => {
  it("is off while nothing waits for a yes or a no", () => {
    expect(faceNeeded(base)).toBe(false);
  });

  it("is on while something waits for an answer", () => {
    expect(faceNeeded({ ...base, answerWaiting: true })).toBe(true);
  });

  it("is off whatever waits when Nod and shake is switched off", () => {
    expect(faceNeeded({ ...base, headGestures: false, answerWaiting: true })).toBe(false);
    expect(faceNeeded({ ...base, headGestures: false, nod: "undo" })).toBe(false);
  });

  it("is always on when a nod or a shake runs a command", () => {
    expect(faceNeeded({ ...base, nod: "undo" })).toBe(true);
    expect(faceNeeded({ ...base, shake: "cancel" })).toBe(true);
  });

  it("is off when neither gesture does anything", () => {
    expect(faceNeeded({ ...base, nod: "none", shake: "none", answerWaiting: true })).toBe(false);
  });
});

/** A store that only notifies when told to. */
function store<T extends object>(value: T) {
  const listeners = new Set<() => void>();
  return Object.assign(value, {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify() {
      for (const listener of listeners) listener();
    },
    listeners,
  });
}

function sources() {
  const features = store({ headGestures: true, on: (_id: "headGestures") => features.headGestures });
  const bindings = store({ value: DEFAULT_BINDINGS as GestureBindings, getSnapshot: () => bindings.value });
  const voice = store({ reviewing: false, canStopSent: false });
  const approvals = store({ pending: [] as unknown[] });
  const offers = store({ waiting: [] as unknown[] });
  const tools = store({ question: null as string | null, getSnapshot: () => ({ question: tools.question }) });
  return { features, bindings, voice, approvals, offers, tools } satisfies FaceDemandSources;
}

describe("watchFaceDemand", () => {
  it("reports at once, then only changes, from every source", () => {
    const s = sources();
    const seen: boolean[] = [];
    const stop = watchFaceDemand(s, (needed) => seen.push(needed));
    expect(seen).toEqual([false]);

    s.tools.question = "Delete Wall 1?";
    s.tools.notify();
    s.tools.notify();
    s.tools.question = null;
    s.tools.notify();
    s.voice.canStopSent = true;
    s.voice.notify();
    s.voice.canStopSent = false;
    s.voice.notify();
    s.approvals.pending = [{}];
    s.approvals.notify();
    s.approvals.pending = [];
    s.approvals.notify();
    s.offers.waiting = [{}];
    s.offers.notify();
    s.features.headGestures = false;
    s.features.notify();
    expect(seen).toEqual([false, true, false, true, false, true, false, true, false]);

    s.features.headGestures = true;
    s.offers.waiting = [];
    s.bindings.value = { ...DEFAULT_BINDINGS, nod: "undo" };
    s.bindings.notify();
    expect(seen.at(-1)).toBe(true);

    stop();
    for (const source of Object.values(s)) expect(source.listeners.size).toBe(0);
  });
});
