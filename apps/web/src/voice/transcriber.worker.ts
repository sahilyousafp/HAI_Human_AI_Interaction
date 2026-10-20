/// <reference lib="webworker" />
// Transcribes speech on this machine with Moonshine base (ONNX) through transformers.js. The model and the ONNX
// runtime are served by the app (scripts/fetch-assets.mjs); nothing is fetched from the internet. Audio arrives
// transferred, is used once and dropped; only text goes back.
import { type AutomaticSpeechRecognitionPipeline, env, pipeline } from "@huggingface/transformers";
import type { FromTranscriber, ToTranscriber } from "./messages.ts";

declare const self: DedicatedWorkerGlobalScope;

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
env.useBrowserCache = false; // the files are local already; no second copy in Cache Storage
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = "/ort/";

const MODEL = "moonshine-base";
const post = (message: FromTranscriber) => self.postMessage(message);

let ready: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

/**
 * WebAssembly with the int8 model: measured on the reference laptop at about 0.2 s per utterance, against about
 * 2 s on WebGPU with the same files (int8 weights are slow there), see docs/decisions.md.
 */
function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  ready ??= (async () => {
    const started = performance.now();
    const transcriber = (await pipeline("automatic-speech-recognition", MODEL, {
      device: "wasm",
      dtype: "q8",
    })) as AutomaticSpeechRecognitionPipeline;
    post({ type: "ready", backend: "WASM", loadMs: Math.round(performance.now() - started) });
    return transcriber;
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

self.onmessage = async (event: MessageEvent<ToTranscriber>) => {
  const message = event.data;
  if (message.type === "load") {
    load().catch((error: Error) =>
      post({ type: "error", message: `The speech model did not load: ${error.message}` }),
    );
    return;
  }
  const { id } = message;
  let audio: Float32Array | null = message.audio;
  try {
    const transcriber = await load();
    const started = performance.now();
    const result = await transcriber(audio);
    audio = null; // released: nothing keeps the samples once there is text
    const text = (Array.isArray(result) ? result[0]?.text : result.text)?.trim() ?? "";
    post({ type: "transcript", id, text, ms: Math.round(performance.now() - started) });
  } catch (error) {
    audio = null;
    post({ type: "error", id, message: `Transcription failed: ${(error as Error).message}` });
  }
};
