/** Messages between the page and the speech synthesis worker. Only text goes in; only audio comes out. */
export type ToSpeaker = { type: "load" } | { type: "speak"; id: number; text: string; voice: string };

export type FromSpeaker =
  | { type: "ready"; backend: "WebGPU"; loadMs: number }
  /** 24 kHz mono samples, transferred. */
  | { type: "audio"; id: number; audio: Float32Array; ms: number }
  /** `unsupported`: this device cannot run the voice fast enough (no WebGPU); a system voice speaks instead. */
  | { type: "error"; id?: number; message: string; unsupported?: boolean };

/** Kokoro's output rate. */
export const KOKORO_RATE = 24_000;

/** The Kokoro voices fetched by `pnpm assets`. */
export const KOKORO_VOICES = {
  af_heart: "Heart (American English, female)",
  am_michael: "Michael (American English, male)",
} as const;
export type KokoroVoice = keyof typeof KOKORO_VOICES;
