import type { Hand, HeldTarget } from "@hai/protocol";
import { type RequestContext, UtteranceContext } from "./utterance-context.ts";
import { VOICE } from "./voice-config.ts";

/** One listening session's speech detector: owns the microphone while it runs. */
export interface Listener {
  /** Ends the utterance now, delivering what was said so far (the talk key was released, or the time is up). */
  finish(): void;
  /** Stops listening and releases the microphone, delivering nothing. */
  cancel(): void;
}

export interface ListenerEvents {
  speechStart(): void;
  /** The utterance ended: 16 kHz samples for on-device transcription, or text from the cloud speech service. */
  speechEnd(result: { audio: Float32Array } | { text: string }): void;
  /** A sound that began like speech ended too soon to count, so nothing was said (only the on-device detector knows). */
  misfire?(): void;
  /** Speech probability or input level, 0..1, for the level meter. */
  level(value: number): void;
}

export interface VoiceDeps {
  /** Opens the microphone and starts detecting speech. Rejects with the getUserMedia error if there is none. */
  listen(events: ListenerEvents): Promise<Listener>;
  /** Turns samples into text on this machine. */
  transcribe(audio: Float32Array): Promise<string>;
  /** Sends the request (and what it refers to) to the agent; false if it could not be sent. */
  send(text: string, context: RequestContext): boolean;
  /** Resolves what the utterance referred to at send time. */
  context(recorder: UtteranceContext): RequestContext;
  /** Whether a transcript starts with a team name (listening for names keeps only those). */
  isNamed?(text: string): boolean;
  /** Whether a transcript is only a team name and a greeting ("Hey Mochi"), with no request after it. */
  isBareName?(text: string): boolean;
  /**
   * A transcript that is only a tool's spoken name, or a command the grammar fully understands, is handled here
   * without the agent: returns what to show for it when it was, null for a request. `context` is what "this" means.
   */
  command?(text: string, context: RequestContext): CommandPick | null;
  /** Stops the request a held pinch just sent (a shake within `HELD_STOP_MS`). */
  stopSent?(): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** What the voice input shows for a transcript that was handled locally: a tool picked, or a command run. */
export interface CommandPick {
  label: string;
  /** A command was run (or refused) rather than a tool picked. */
  ran?: boolean;
}

export type MicError = "denied" | "not-found" | "failed";

/** How long after a held request is sent a shake still stops it, ms. */
export const HELD_STOP_MS = 1500;

/**
 * Where voice input is. `held` names the hand whose long pinch is listening: those requests show beside the hand
 * rather than in the voice bar, and are sent on release without a countdown.
 */
export type VoiceState =
  | { phase: "off" }
  /** Listening for a team name (opt-in): the microphone is open and only named utterances become requests. */
  | { phase: "names"; speaking: boolean; heard?: string }
  | { phase: "starting"; held?: Hand }
  | { phase: "listening"; speaking: boolean; level: number; held?: Hand }
  | { phase: "transcribing"; held?: Hand }
  /** Waiting to be sent: at `sendAt` unless `paused` (being edited). */
  | { phase: "review"; text: string; sendAt: number; paused: boolean }
  | { phase: "sent"; text: string; held?: Hand }
  /** A held request was stopped by a shake right after it was sent. */
  | { phase: "stopped"; text: string; held: Hand }
  /** The transcript was a tool's name or a command: it was handled here, and nothing was sent. */
  | { phase: "picked"; text: string; tool: string; ran?: boolean; held?: Hand }
  | { phase: "discarded"; text: string }
  /** `held`: the microphone failed for a held pinch, so the chip beside that hand says so too. */
  | { phase: "error"; error: MicError; message: string; held?: Hand };

const MESSAGES: Record<MicError, string> = {
  denied:
    "The microphone is blocked for this page. Allow it from the icon at the left of the address bar, then try again. You can still type.",
  "not-found": "No microphone was found. Connect one and try again, or type your request.",
  failed: "The microphone could not start. Check that no other app is using it, or type your request.",
};

/** Which recovery message a getUserMedia (or model loading) failure gets. */
export function micError(error: unknown): MicError {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError")
    return "not-found";
  return "failed";
}

/** A held pinch that is listening: what has been heard so far and where the pinch is. */
interface HeldRequest {
  hand: Hand;
  session: number;
  audio: Float32Array[];
  texts: string[];
  speaking: boolean;
  spoke: boolean;
  releasing: boolean;
}

/** One buffer of all the samples, in order. */
function joined(parts: Float32Array[]): Float32Array {
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}

/**
 * Voice requests to the agent: listens only when asked (the microphone button, the talk key, or Ask agent),
 * ends the utterance on silence, transcribes it, and shows the transcript for `VOICE.sendDelayMs` before sending,
 * so a nod or Enter sends it at once and a shake or Escape discards it. What the user points at while speaking
 * is recorded alongside.
 */
export class VoiceInput {
  readonly context = new UtteranceContext();
  private state: VoiceState = { phase: "off" };
  private readonly listeners = new Set<() => void>();
  private listener: Listener | null = null;
  private session = 0;
  private timers: unknown[] = [];
  private sendTimer: unknown = null;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private namesWanted = false;
  /** The request was ended by the user while speech was being heard: the microphone is closing, not listening on. */
  private finishing = false;
  /** The open microphone while listening for names, and the session it belongs to. */
  private namesListener: Listener | null = null;
  private namesSession = 0;
  /** A spoken request is taking the microphone: do not reopen it for names meanwhile. */
  private holdNames = false;
  /** The microphone is opening to listen for names. */
  private namesOpening = false;
  private hovered: () => string | null = () => null;
  /** A bare name was heard ("Hey Mochi"): the rest of the request is awaited until this timer ends. */
  private pendingName: { text: string; timer: unknown } | null = null;
  /**
   * A held pinch is listening: what it heard so far, across pauses, until the pinch is released (`releasing`: it was,
   * with speech, and the last words are on their way).
   */
  private held: HeldRequest | null = null;
  private readonly heldSpeech = new Set<(hand: Hand) => void>();

  constructor(private readonly deps: VoiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): VoiceState => this.state;

  /** The microphone is (or is about to be) live. */
  get micOn(): boolean {
    return this.micState !== "off";
  }

  /** What the microphone is doing: listening for a request, listening for names, or nothing. */
  get micState(): "on" | "names" | "off" {
    if (this.state.phase === "starting" || this.state.phase === "listening") return "on";
    if (this.state.phase === "names" || this.namesListener || this.namesOpening) return "names";
    return "off";
  }

  /** Whether the microphone stays open listening for team names. */
  get listeningForNames(): boolean {
    return this.namesWanted;
  }

  /**
   * Turns listening for names on or off. While on, the microphone stays open between requests; each utterance is
   * transcribed here, and one that starts with a team name goes to review like any spoken request. Anything else is
   * dropped at once: never shown, sent or kept.
   */
  setListenForNames(on: boolean): void {
    if (on === this.namesWanted) return;
    this.namesWanted = on;
    if (on) this.resumeNames();
    else this.stopNames();
  }

  get reviewing(): boolean {
    return this.state.phase === "review";
  }

  /** Starts listening. Ignored while already listening or transcribing. */
  async start(hoveredId: () => string | null = () => null): Promise<void> {
    const { phase } = this.state;
    if (phase === "starting" || phase === "listening" || phase === "transcribing") return;
    // The button or the talk key takes the microphone; listening for names resumes once this request is done.
    this.holdNames = true;
    if (phase === "review") this.discard();
    this.stopNames();
    const session = ++this.session;
    this.finishing = false;
    this.context.clear();
    this.update({ phase: "starting" });
    this.holdNames = false;
    try {
      const listener = await this.deps.listen({
        speechStart: () => {
          if (session !== this.session) return;
          this.clearTimers();
          this.context.begin(this.now(), hoveredId());
          this.after(VOICE.maxUtteranceMs, () => this.listener?.finish());
          this.ticking(session);
          this.update({ phase: "listening", speaking: true, level: 1 });
        },
        speechEnd: (result) => void this.ended(session, result),
        misfire: () => {
          if (session !== this.session) return;
          // Ended while the sound was too short to count: nothing is coming. Otherwise listening goes on.
          if (this.finishing) this.cancel();
          else this.waitForSpeech();
        },
        level: (value) => {
          if (session === this.session && this.state.phase === "listening")
            this.update({ ...this.state, level: value });
        },
      });
      if (session !== this.session) {
        listener.cancel(); // cancelled while the microphone was opening
        return;
      }
      this.listener = listener;
      this.waitForSpeech();
    } catch (error) {
      if (session !== this.session) return;
      const kind = micError(error);
      this.update({ phase: "error", error: kind, message: MESSAGES[kind] });
    }
  }

  /** Listening with nothing heard yet: gives up when no one speaks for `VOICE.noSpeechMs`. */
  private waitForSpeech(): void {
    this.clearTimers();
    this.update({ phase: "listening", speaking: false, level: 0 });
    this.after(VOICE.noSpeechMs, () => {
      if (this.state.phase === "listening" && !this.state.speaking) this.cancel();
    });
  }

  /** The talk key was released or the microphone button pressed again: end the utterance now. */
  finish(): void {
    if (this.state.phase === "starting") this.cancel(); // stopped before the microphone was even open
    if (this.state.phase !== "listening") return;
    if (this.state.speaking) {
      this.finishing = true;
      this.listener?.finish();
    } else this.cancel();
  }

  /** Takes text as though it had just been spoken: a command runs, a request is shown for sending. */
  hear(text: string): void {
    void this.ended(this.session, { text });
  }

  /** Stops listening without sending anything. */
  cancel(): void {
    this.session++;
    this.held = null;
    this.clearTimers();
    this.listener?.cancel();
    this.listener = null;
    this.context.clear();
    if (this.state.phase !== "review" && this.state.phase !== "names") this.update({ phase: "off" });
  }

  // Held pinch

  /** The hand whose held pinch is listening, if any. */
  get holding(): Hand | null {
    return this.held?.hand ?? null;
  }

  /** Calls `listener` when speech starts during a held pinch. Returns a function that stops calling it. */
  onHeldSpeech = (listener: (hand: Hand) => void): (() => void) => {
    this.heldSpeech.add(listener);
    return () => this.heldSpeech.delete(listener);
  };

  /**
   * A long pinch is held: listen until it is released, about `target`. Pauses do not end it; what is said is
   * collected and sent as one request on release (`releaseHeld`). Returns false, starting nothing, while another
   * request is being listened to or written down.
   */
  startHeld(hand: Hand, target: HeldTarget | null): boolean {
    const { phase } = this.state;
    if (this.held || phase === "starting" || phase === "listening" || phase === "transcribing") return false;
    this.holdNames = true;
    if (phase === "review") this.discard();
    this.stopNames();
    const session = ++this.session;
    this.context.clear();
    this.context.lock(target);
    this.held = { hand, session, audio: [], texts: [], speaking: false, spoke: false, releasing: false };
    this.update({ phase: "starting", held: hand });
    this.holdNames = false;
    void this.openHeld(session, hand);
    return true;
  }

  private async openHeld(session: number, hand: Hand): Promise<void> {
    try {
      const listener = await this.deps.listen({
        speechStart: () => {
          const held = this.held;
          if (session !== this.session || !held) return;
          held.speaking = true;
          if (!held.spoke) {
            held.spoke = true;
            // What the hand rests on counts from the first word; the hold may not run on for ever.
            this.context.begin(this.now(), null);
            this.ticking(session);
            this.after(VOICE.maxUtteranceMs, () => this.releaseHeld(true));
            for (const listener of this.heldSpeech) listener(hand);
          }
          this.update({ phase: "listening", speaking: true, level: 1, held: hand });
        },
        speechEnd: (result) => this.heardHeld(session, result),
        misfire: () => {
          const held = this.held;
          if (session === this.session && held) this.segmentOver(held);
        },
        level: (value) => {
          if (session === this.session && this.state.phase === "listening")
            this.update({ ...this.state, level: value });
        },
      });
      if (session !== this.session) {
        listener.cancel(); // released while the microphone was opening
        return;
      }
      this.listener = listener;
      if (this.state.phase === "starting")
        this.update({ phase: "listening", speaking: false, level: 0, held: hand });
    } catch (error) {
      if (session !== this.session) return;
      this.held = null;
      this.context.clear();
      const kind = micError(error);
      this.update({ phase: "error", error: kind, message: MESSAGES[kind], held: hand });
    }
  }

  /** A pause in a held request: keep what was said and go on listening (unless the pinch was let go meanwhile). */
  private heardHeld(session: number, result: { audio: Float32Array } | { text: string }): void {
    const held = this.held;
    if (session !== this.session || !held) return;
    if ("text" in result) held.texts.push(result.text);
    else held.audio.push(result.audio);
    this.segmentOver(held);
  }

  /**
   * A stretch of speech in a held request is over, said or too short to count: listening goes on, unless the pinch
   * was let go meanwhile, which sends what was said (or stops, if nothing was).
   */
  private segmentOver(held: HeldRequest): void {
    held.speaking = false;
    if (!held.releasing) {
      this.update({ phase: "listening", speaking: false, level: 0, held: held.hand });
      return;
    }
    if (held.audio.length + held.texts.length > 0) void this.finishHeld();
    else this.cancel();
  }

  /**
   * The held pinch was released: with `send` and something said, it is written down and sent at once (or picks a
   * tool); otherwise the microphone stops and nothing is sent.
   */
  releaseHeld(send: boolean): void {
    const held = this.held;
    if (!held) return;
    const said = held.audio.length + held.texts.length > 0;
    if (!send || !(held.speaking || said)) {
      this.cancel();
      return;
    }
    held.releasing = true;
    // Still speaking: the words so far arrive through `heardHeld`, which then finishes.
    if (held.speaking) this.listener?.finish();
    else void this.finishHeld();
  }

  private async finishHeld(): Promise<void> {
    const held = this.held;
    if (!held) return;
    this.held = null;
    const { session, hand } = held;
    this.clearTimers();
    this.listener?.cancel();
    this.listener = null;
    this.context.end(this.now());
    this.update({ phase: "transcribing", held: hand });
    let text: string;
    try {
      text = held.texts.length > 0 ? held.texts.join(" ") : await this.deps.transcribe(joined(held.audio));
    } catch (error) {
      if (session !== this.session) return;
      this.context.clear();
      this.update({ phase: "error", error: "failed", message: (error as Error).message });
      return;
    }
    if (session !== this.session) return;
    text = text.trim();
    if (!text) {
      this.context.clear();
      this.update({ phase: "off" });
      return;
    }
    const pick = this.deps.command?.(text, this.deps.context(this.context));
    if (pick) {
      this.context.clear();
      this.update({
        phase: "picked",
        text,
        tool: pick.label,
        ...(pick.ran ? { ran: true } : {}),
        held: hand,
      });
      return;
    }
    // The hold was the deliberate act: no countdown.
    if (!this.deps.send(text, this.deps.context(this.context))) {
      this.update({ phase: "off" });
      return;
    }
    this.context.clear();
    this.update({ phase: "sent", text, held: hand });
    this.sendTimer = this.setTimer(() => {
      this.sendTimer = null;
      if (this.state.phase === "sent" && this.state.held) this.update({ phase: "off" });
    }, HELD_STOP_MS);
  }

  /** A shake: stops a held request sent within `HELD_STOP_MS`. Returns whether there was one. */
  stopSent(): boolean {
    const { state } = this;
    if (state.phase !== "sent" || !state.held || this.sendTimer === null) return false;
    this.clearSendTimer();
    this.deps.stopSent?.();
    this.update({ phase: "stopped", text: state.text, held: state.held });
    this.sendTimer = this.setTimer(() => {
      this.sendTimer = null;
      if (this.state.phase === "stopped") this.update({ phase: "off" });
    }, HELD_STOP_MS);
    return true;
  }

  /** What the hand points at, for what a request named while listening for names refers to. */
  setHovered(hoveredId: () => string | null): void {
    this.hovered = hoveredId;
  }

  /** Sends the transcript now (nod or Enter). */
  confirm(): void {
    if (this.state.phase === "review") this.send(this.state.text);
  }

  /** Throws the transcript away (shake or Escape). */
  discard(): void {
    if (this.state.phase !== "review") return;
    this.clearSendTimer();
    this.context.clear();
    this.update({ phase: "discarded", text: this.state.text });
  }

  /** The user is correcting the transcript: wait for them (Enter sends it). */
  edit(text: string): void {
    if (this.state.phase !== "review") return;
    this.clearSendTimer();
    this.update({ ...this.state, text, paused: true });
  }

  /** Dismisses an error or a finished request. */
  dismiss(): void {
    const { phase } = this.state;
    if (
      phase === "error" ||
      phase === "sent" ||
      phase === "discarded" ||
      phase === "picked" ||
      phase === "stopped"
    )
      this.update({ phase: "off" });
  }

  private async ended(session: number, result: { audio: Float32Array } | { text: string }): Promise<void> {
    if (session !== this.session) return;
    this.clearTimers();
    this.context.end(this.now());
    this.listener?.cancel(); // the microphone stops as soon as the utterance ends
    this.listener = null;
    let text: string;
    if ("text" in result) {
      text = result.text;
    } else {
      this.update({ phase: "transcribing" });
      try {
        text = await this.deps.transcribe(result.audio);
      } catch (error) {
        if (session !== this.session) return;
        this.update({ phase: "error", error: "failed", message: (error as Error).message });
        return;
      }
    }
    if (session !== this.session) return;
    text = text.trim();
    if (!text) {
      this.context.clear();
      this.update({ phase: "off" });
      return;
    }
    if (this.picked(text)) return;
    this.review(text);
  }

  /** A transcript that is a tool's name or a command is handled at once: no countdown, nothing sent. */
  private picked(text: string): boolean {
    const pick = this.deps.command?.(text, this.deps.context(this.context));
    if (!pick) return false;
    this.context.clear();
    this.update({ phase: "picked", text, tool: pick.label, ...(pick.ran ? { ran: true } : {}) });
    return true;
  }

  /** Shows a transcript for the send delay; a nod or Enter sends it now, a shake or Escape discards it. */
  private review(text: string): void {
    this.update({ phase: "review", text, sendAt: this.now() + VOICE.sendDelayMs, paused: false });
    this.sendTimer = this.setTimer(() => {
      this.sendTimer = null;
      if (this.state.phase === "review" && !this.state.paused) this.send(this.state.text);
    }, VOICE.sendDelayMs);
  }

  private send(text: string): void {
    this.clearSendTimer();
    const context = this.deps.context(this.context);
    if (this.deps.send(text, context)) {
      this.context.clear();
      this.update({ phase: "sent", text });
    }
  }

  /** While speaking, settle the pointer's dwell regularly so markers appear on time. */
  private ticking(session: number): void {
    const tick = () => {
      const { phase } = this.state;
      if (session !== this.session || (phase !== "listening" && !(phase === "names" && this.state.speaking)))
        return;
      this.context.tick(this.now());
      this.timers.push(this.setTimer(tick, 100));
    };
    this.timers.push(this.setTimer(tick, 100));
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(this.setTimer(fn, ms));
  }

  private clearTimers(): void {
    for (const t of this.timers) this.clearTimer(t);
    this.timers = [];
  }

  private clearSendTimer(): void {
    if (this.sendTimer !== null) this.clearTimer(this.sendTimer);
    this.sendTimer = null;
  }

  /** Whether the microphone is free for listening for names: no spoken request is under way. */
  private get idle(): boolean {
    const { phase } = this.state;
    return (
      phase === "off" ||
      phase === "names" ||
      phase === "sent" ||
      phase === "discarded" ||
      phase === "picked" ||
      phase === "stopped"
    );
  }

  /**
   * Opens the microphone to listen for names, if wanted and nothing else is using it. A request just sent or
   * discarded stays on show meanwhile.
   */
  private resumeNames(): void {
    if (!this.namesWanted || this.holdNames || this.namesListener || this.namesOpening || !this.idle) return;
    const session = ++this.namesSession;
    this.namesOpening = true;
    if (this.state.phase === "off") this.update({ phase: "names", speaking: false });
    else this.notify();
    this.deps
      .listen({
        speechStart: () => {
          if (session !== this.namesSession || !this.idle) return;
          this.context.clear();
          this.context.begin(this.now(), this.hovered());
          // Someone is speaking again: the wait for the rest of a request does not run out mid-sentence.
          if (this.pendingName) this.clearTimer(this.pendingName.timer);
          this.update({
            phase: "names",
            speaking: true,
            ...(this.pendingName ? { heard: this.pendingName.text } : {}),
          });
          this.ticking(this.session);
        },
        speechEnd: (result) => void this.heard(session, result),
        level: () => {},
      })
      .then(
        (listener) => {
          if (session !== this.namesSession) {
            listener.cancel(); // turned off while the microphone opened
            return;
          }
          this.namesOpening = false;
          this.namesListener = listener;
          this.notify();
        },
        (error) => {
          if (session !== this.namesSession) return;
          this.namesOpening = false;
          this.namesWanted = false;
          const kind = micError(error);
          this.update({ phase: "error", error: kind, message: MESSAGES[kind] });
        },
      );
  }

  private stopNames(): void {
    this.dropPendingName();
    this.namesSession++;
    this.namesOpening = false;
    this.namesListener?.cancel();
    this.namesListener = null;
    if (this.state.phase === "names") {
      this.context.clear();
      this.update({ phase: "off" });
    } else {
      this.notify();
    }
  }

  /** An utterance while listening for names: kept only if it starts with a team name. */
  private async heard(session: number, result: { audio: Float32Array } | { text: string }): Promise<void> {
    if (session !== this.namesSession || !this.idle) return;
    this.context.end(this.now());
    let text: string;
    try {
      text = "text" in result ? result.text : await this.deps.transcribe(result.audio);
    } catch {
      text = "";
    }
    if (session !== this.namesSession || !this.idle) return;
    text = text.trim();
    // The name came first and the request follows: both are one request.
    if (this.pendingName) {
      const { text: name } = this.pendingName;
      if (!text) {
        this.waitForRest(name); // noise, or nothing the model could write: keep waiting
        return;
      }
      this.dropPendingName();
      this.review(this.deps.isNamed?.(text) ? text : `${name} ${text}`);
      return;
    }
    if (text && this.deps.isNamed?.(text)) {
      if (this.deps.isBareName?.(text)) {
        this.waitForRest(text);
        return;
      }
      this.review(text);
      return;
    }
    // Not for the team: dropped here, in memory, and listening goes on.
    this.context.clear();
    this.update({ phase: "names", speaking: false });
  }

  /** "Hey Mochi" alone: the microphone stays open for the rest of the request, then the name is sent as it is. */
  private waitForRest(name: string): void {
    if (this.pendingName) this.clearTimer(this.pendingName.timer);
    const timer = this.setTimer(() => {
      if (this.pendingName?.timer !== timer) return;
      this.pendingName = null;
      this.review(name);
    }, VOICE.afterNameMs);
    this.pendingName = { text: name, timer };
    this.update({ phase: "names", speaking: false, heard: name });
  }

  private dropPendingName(): void {
    if (this.pendingName) this.clearTimer(this.pendingName.timer);
    this.pendingName = null;
  }

  private update(state: VoiceState): void {
    this.state = state;
    this.notify();
    // A spoken request has finished (sent, discarded or cancelled): listening for names resumes.
    this.resumeNames();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
