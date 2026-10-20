/** Messages between the page and the transcription worker. Audio only ever travels into the worker, never out. */
export type ToTranscriber =
  | { type: "load" }
  /** 16 kHz mono samples in [-1, 1], transferred (the page keeps no copy). */
  | { type: "transcribe"; id: number; audio: Float32Array };

export type FromTranscriber =
  | { type: "ready"; backend: "WASM"; loadMs: number }
  | { type: "transcript"; id: number; text: string; ms: number }
  | { type: "error"; id?: number; message: string };
