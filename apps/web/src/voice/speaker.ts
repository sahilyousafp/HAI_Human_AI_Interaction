import { SentenceSplitter } from "./phonemes.ts";
import { type FromSpeaker, KOKORO_RATE, type KokoroVoice, type ToSpeaker } from "./speaker-messages.ts";

/** One sentence being prepared to speak: wait for it, play it, or drop it. */
export interface PreparedSpeech {
  /** Resolves when the sentence can start at once (synthesised), rejects if it cannot be spoken. */
  ready: Promise<void>;
  /** Speaks it; resolves when it has been said (or cut off by cancel). */
  play(): Promise<void>;
  cancel(): void;
}

/** A way to speak: the Kokoro voice on WebGPU, or a voice installed on the computer. */
export interface VoiceEngine {
  /** Shown in the Voice settings. */
  readonly label: string;
  prepare(text: string): PreparedSpeech;
  /** The sentence as samples, where the engine makes them (for checking what it says). */
  synthesize?(text: string): Promise<{ audio: Float32Array; rate: number }>;
}

export interface SpeakerStats {
  /** What speaks: null until known, "none" when nothing on this device can. */
  engine: string | null;
  /** Time from a sentence being complete to its first sound, ms, for the last replies (newest last). */
  firstAudio: number[];
}

/**
 * Speaks Mochi's replies sentence by sentence as they stream in, on this machine. The next sentence is prepared
 * while the current one plays. Talking to the agent (or stop) interrupts at once; muted, nothing is spoken.
 */
export class Speaker {
  private readonly splitters = new Map<string, SentenceSplitter>();
  private queue: Array<{ speech: PreparedSpeech; at: number; first: boolean }> = [];
  private current: PreparedSpeech | null = null;
  private generation = 0;
  private playing = false;
  private muted = false;
  /** Turns whose first sentence has been queued (for the first-audio statistic). */
  private readonly started = new Set<string>();
  private stats: SpeakerStats = { engine: null, firstAudio: [] };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly engine: () => Promise<VoiceEngine | null>,
    private readonly now: () => number = () => performance.now(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SpeakerStats => this.stats;

  /** Starts loading the voice (a request was sent, so a reply is coming). */
  warm(): void {
    if (!this.muted) void this.resolveEngine();
  }

  /** A sentence as samples, from the voice in use (null without a voice that makes samples). */
  async synthesize(text: string): Promise<{ audio: Float32Array; rate: number } | null> {
    const engine = await this.resolveEngine();
    return (await engine?.synthesize?.(text)) ?? null;
  }

  /** Whether something is being said or waits to be. */
  get speaking(): boolean {
    return this.playing || this.queue.length > 0;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stop();
    this.notify();
  }

  /** A piece of a reply streaming in. */
  feed(turnId: string, text: string): void {
    if (this.muted) return;
    let splitter = this.splitters.get(turnId);
    if (!splitter) {
      splitter = new SentenceSplitter();
      this.splitters.set(turnId, splitter);
    }
    for (const sentence of splitter.push(text)) void this.enqueue(turnId, sentence);
  }

  /** The reply is complete: speak what is left of it. */
  end(turnId: string): void {
    const splitter = this.splitters.get(turnId);
    this.splitters.delete(turnId);
    this.started.delete(turnId);
    if (!splitter || this.muted) return;
    for (const sentence of splitter.flush()) void this.enqueue(turnId, sentence);
  }

  /** Stops speaking now and drops what was waiting (the user talks, or stops the agent). */
  stop(): void {
    this.generation++;
    for (const { speech } of this.queue) speech.cancel();
    this.queue = [];
    this.current?.cancel();
    this.current = null;
    this.playing = false;
    this.splitters.clear();
    this.started.clear();
    this.notify();
  }

  private async enqueue(turnId: string, sentence: string): Promise<void> {
    const generation = this.generation;
    const engine = await this.resolveEngine();
    if (!engine || generation !== this.generation || this.muted) return;
    const first = !this.started.has(turnId);
    this.started.add(turnId);
    this.queue.push({ speech: engine.prepare(sentence), at: this.now(), first });
    this.notify();
    void this.run();
  }

  /** Plays the queue in order; each sentence was already being prepared while the one before it played. */
  private async run(): Promise<void> {
    if (this.playing) return;
    const generation = this.generation;
    this.playing = true;
    while (this.queue.length > 0 && generation === this.generation) {
      const next = this.queue.shift();
      if (!next) break;
      this.current = next.speech;
      try {
        await next.speech.ready;
      } catch {
        continue; // that sentence could not be spoken; go on with the next
      }
      if (generation !== this.generation) return;
      if (next.first)
        this.update({ firstAudio: [...this.stats.firstAudio.slice(-19), Math.round(this.now() - next.at)] });
      await next.speech.play();
    }
    if (generation === this.generation) {
      this.playing = false;
      this.current = null;
      this.notify();
    }
  }

  private async resolveEngine(): Promise<VoiceEngine | null> {
    const engine = await this.engine();
    const label = engine?.label ?? "none";
    if (this.stats.engine !== label) this.update({ engine: label });
    return engine;
  }

  private update(partial: Partial<SpeakerStats>): void {
    this.stats = { ...this.stats, ...partial };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * The Kokoro voice, synthesised in a worker on WebGPU and played with the Web Audio API. Resolves to null when
 * the device cannot run it (no WebGPU), so a system voice takes over.
 */
export function kokoroEngine(voice: () => KokoroVoice): Promise<VoiceEngine | null> {
  const worker = new Worker(new URL("./speaker.worker.ts", import.meta.url), { type: "module" });
  const waiting = new Map<number, { resolve(audio: Float32Array): void; reject(error: Error): void }>();
  let nextId = 1;
  let context: AudioContext | null = null;
  const post = (message: ToSpeaker) => worker.postMessage(message);

  return new Promise((resolve) => {
    worker.onmessage = (event: MessageEvent<FromSpeaker>) => {
      const message = event.data;
      if (message.type === "ready") {
        resolve(engine);
        return;
      }
      const { id } = message;
      if (id === undefined) {
        // The voice cannot load here: a system voice speaks instead.
        worker.terminate();
        resolve(null);
        return;
      }
      const pending = waiting.get(id);
      if (!pending) return;
      waiting.delete(id);
      if (message.type === "audio") pending.resolve(message.audio);
      else pending.reject(new Error(message.message));
    };
    post({ type: "load" });

    const synthesize = (text: string) => {
      const id = nextId++;
      const audio = new Promise<Float32Array>((resolveAudio, reject) =>
        waiting.set(id, { resolve: resolveAudio, reject }),
      );
      post({ type: "speak", id, text, voice: voice() });
      return audio;
    };
    const engine: VoiceEngine = {
      label: "Kokoro on this laptop (WebGPU)",
      synthesize: async (text) => ({ audio: await synthesize(text), rate: KOKORO_RATE }),
      prepare(text) {
        let cancelled = false;
        let source: AudioBufferSourceNode | null = null;
        const audio = synthesize(text);
        return {
          ready: audio.then(() => undefined),
          async play() {
            const samples = await audio;
            if (cancelled) return;
            context ??= new AudioContext({ sampleRate: KOKORO_RATE });
            if (context.state === "suspended") await context.resume();
            const buffer = context.createBuffer(1, samples.length, KOKORO_RATE);
            buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
            source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            const ended = new Promise<void>((done) => {
              if (source) source.onended = () => done();
            });
            source.start();
            await ended;
          },
          cancel() {
            cancelled = true;
            try {
              source?.stop();
            } catch {
              // not started yet
            }
          },
        };
      },
    };
  });
}

/** A voice installed on the computer (`localService`: it speaks without the network), English if there is one. */
export function systemEngine(): Promise<VoiceEngine | null> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve(null);
  const pick = () => {
    const local = speechSynthesis.getVoices().filter((v) => v.localService);
    return local.find((v) => v.lang.startsWith("en")) ?? local[0] ?? null;
  };
  return new Promise((resolve) => {
    const choose = () => {
      const voice = pick();
      resolve(voice ? engineFor(voice) : null);
    };
    if (speechSynthesis.getVoices().length > 0) choose();
    else {
      speechSynthesis.addEventListener("voiceschanged", choose, { once: true });
      setTimeout(choose, 1500); // some browsers never fire it when there are no voices
    }
  });

  function engineFor(voice: SpeechSynthesisVoice): VoiceEngine {
    return {
      label: `${voice.name} (installed on this computer)`,
      prepare(text) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        let cancelled = false;
        return {
          ready: Promise.resolve(),
          play: () =>
            new Promise<void>((done) => {
              if (cancelled) return done();
              utterance.onend = () => done();
              utterance.onerror = () => done();
              speechSynthesis.speak(utterance);
            }),
          cancel() {
            cancelled = true;
            speechSynthesis.cancel();
          },
        };
      },
    };
  }
}

/** Kokoro where it can run, else a voice installed on the computer, else nothing. Decided once. */
export function bestEngine(voice: () => KokoroVoice): () => Promise<VoiceEngine | null> {
  let chosen: Promise<VoiceEngine | null> | null = null;
  return () => {
    chosen ??= kokoroEngine(voice).then((kokoro) => kokoro ?? systemEngine());
    return chosen;
  };
}

/** Linear resampling, enough to hand synthesised speech to the 16 kHz recogniser. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const t = x - i0;
    out[i] = (input[i0] ?? 0) * (1 - t) + (input[i0 + 1] ?? 0) * t;
  }
  return out;
}
