import type { FromTranscriber, ToTranscriber } from "./messages.ts";

export interface TranscriberStats {
  backend: "WASM" | null;
  /** End of speech to transcript, ms, for the last utterances (newest last). */
  latencies: number[];
}

/**
 * The page's side of the transcription worker. The worker (and its model) starts on first use; audio is
 * transferred into it, so the page keeps no copy.
 */
export class Transcriber {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    { resolve(text: string): void; reject(error: Error): void; at: number }
  >();
  private stats: TranscriberStats = { backend: null, latencies: [] };
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TranscriberStats => this.stats;

  /** Starts loading the model (call when listening starts, so it is ready when speech ends). */
  load(): void {
    this.ensure();
  }

  transcribe(audio: Float32Array): Promise<string> {
    const worker = this.ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, at: performance.now() });
      this.post(worker, { type: "transcribe", id, audio }, [audio.buffer]);
    });
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./transcriber.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<FromTranscriber>) => this.receive(event.data);
    this.post(worker, { type: "load" });
    this.worker = worker;
    return worker;
  }

  private post(worker: Worker, message: ToTranscriber, transfer: Transferable[] = []): void {
    worker.postMessage(message, transfer);
  }

  private receive(message: FromTranscriber): void {
    if (message.type === "ready") {
      this.update({ ...this.stats, backend: message.backend });
      return;
    }
    if (message.type === "error" && message.id === undefined) {
      for (const [id, pending] of this.waiting) {
        pending.reject(new Error(message.message));
        this.waiting.delete(id);
      }
      return;
    }
    const pending = message.id !== undefined ? this.waiting.get(message.id) : undefined;
    if (!pending || message.id === undefined) return;
    this.waiting.delete(message.id);
    if (message.type === "error") {
      pending.reject(new Error(message.message));
      return;
    }
    const latency = Math.round(performance.now() - pending.at);
    this.update({ ...this.stats, latencies: [...this.stats.latencies.slice(-19), latency] });
    pending.resolve(message.text);
  }

  private update(stats: TranscriberStats): void {
    this.stats = stats;
    for (const listener of this.listeners) listener();
  }
}

/** The 90th percentile of the given latencies, or null without any. */
export function p90(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)] ?? null;
}
