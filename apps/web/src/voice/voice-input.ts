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
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export type MicError = "denied" | "not-found" | "failed";

export type VoiceState =
  | { phase: "off" }
  | { phase: "starting" }
  | { phase: "listening"; speaking: boolean; level: number }
  | { phase: "transcribing" }
  /** Waiting to be sent: at `sendAt` unless `paused` (being edited). */
  | { phase: "review"; text: string; sendAt: number; paused: boolean }
  | { phase: "sent"; text: string }
  | { phase: "discarded"; text: string }
  | { phase: "error"; error: MicError; message: string };

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
    return this.state.phase === "starting" || this.state.phase === "listening";
  }

  get reviewing(): boolean {
    return this.state.phase === "review";
  }

  /** Starts listening. Ignored while already listening or transcribing. */
  async start(hoveredId: () => string | null = () => null): Promise<void> {
    const { phase } = this.state;
    if (phase === "starting" || phase === "listening" || phase === "transcribing") return;
    if (phase === "review") this.discard();
    const session = ++this.session;
    this.context.clear();
    this.update({ phase: "starting" });
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
      this.update({ phase: "listening", speaking: false, level: 0 });
      this.after(VOICE.noSpeechMs, () => {
        if (this.state.phase === "listening" && !this.state.speaking) this.cancel();
      });
    } catch (error) {
      if (session !== this.session) return;
      const kind = micError(error);
      this.update({ phase: "error", error: kind, message: MESSAGES[kind] });
    }
  }

  /** The talk key was released or the microphone button pressed again: end the utterance now. */
  finish(): void {
    if (this.state.phase === "starting") this.cancel(); // stopped before the microphone was even open
    if (this.state.phase !== "listening") return;
    if (this.state.speaking) this.listener?.finish();
    else this.cancel();
  }

  /** Stops listening without sending anything. */
  cancel(): void {
    this.session++;
    this.clearTimers();
    this.listener?.cancel();
    this.listener = null;
    this.context.clear();
    if (this.state.phase !== "review") this.update({ phase: "off" });
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
    if (this.state.phase === "error" || this.state.phase === "sent" || this.state.phase === "discarded")
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
      if (session !== this.session || this.state.phase !== "listening") return;
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

  private update(state: VoiceState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
