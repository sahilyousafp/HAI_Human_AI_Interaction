/// <reference lib="webworker" />
// Speaks Mochi's replies on this machine with Kokoro-82M (ONNX, full precision) on WebGPU, through transformers.js,
// with phonemize for English text to phonemes. The model and voices are served by the app (scripts/fetch-assets.mjs);
// nothing is fetched from the internet and no text leaves the machine. See docs/decisions.md for why WebGPU in fp32.
import { AutoTokenizer, env, StyleTextToSpeech2Model, Tensor } from "@huggingface/transformers";
import { textToPhonemes } from "./phonemes.ts";
import type { FromSpeaker, ToSpeaker } from "./speaker-messages.ts";

declare const self: DedicatedWorkerGlobalScope;

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
env.useBrowserCache = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = "/ort/";

const MODEL = "kokoro";
/** Kokoro's style vectors: one 256-value row per input length, up to its context. */
const STYLE_SIZE = 256;
const MAX_TOKENS = 509;

const post = (message: FromSpeaker, transfer: Transferable[] = []) => self.postMessage(message, transfer);

interface Kokoro {
  model: Awaited<ReturnType<typeof StyleTextToSpeech2Model.from_pretrained>>;
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
}

let ready: Promise<Kokoro> | null = null;
const voices = new Map<string, Promise<Float32Array>>();

class Unsupported extends Error {}

function load(): Promise<Kokoro> {
  ready ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu || !(await gpu.requestAdapter()))
      throw new Unsupported("WebGPU is not available on this device.");
    const started = performance.now();
    const [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(MODEL, { dtype: "fp32", device: "webgpu" }),
      AutoTokenizer.from_pretrained(MODEL),
    ]);
    post({ type: "ready", backend: "WebGPU", loadMs: Math.round(performance.now() - started) });
    return { model, tokenizer };
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

function voice(name: string): Promise<Float32Array> {
  let loaded = voices.get(name);
  if (!loaded) {
    loaded = fetch(`/models/kokoro/voices/${name}.bin`).then(async (res) => {
      if (!res.ok) throw new Error(`The voice ${name} is missing: run pnpm assets.`);
      return new Float32Array(await res.arrayBuffer());
    });
    voices.set(name, loaded);
    loaded.catch(() => voices.delete(name));
  }
  return loaded;
}

const fail = (error: unknown, id?: number) =>
  post({
    type: "error",
    ...(id !== undefined ? { id } : {}),
    message: (error as Error).message,
    ...(error instanceof Unsupported ? { unsupported: true } : {}),
  });

self.onmessage = async (event: MessageEvent<ToSpeaker>) => {
  const message = event.data;
  if (message.type === "load") {
    load().catch((error) => fail(error));
    return;
  }
  const { id, text } = message;
  try {
    const [{ model, tokenizer }, style] = await Promise.all([load(), voice(message.voice)]);
    const started = performance.now();
    const { input_ids } = tokenizer(textToPhonemes(text), { truncation: true });
    const tokens = Math.min(Math.max((input_ids.dims.at(-1) ?? 2) - 2, 0), MAX_TOKENS);
    const row = style.slice(tokens * STYLE_SIZE, (tokens + 1) * STYLE_SIZE);
    const { waveform } = await model({
      input_ids,
      style: new Tensor("float32", row, [1, STYLE_SIZE]),
      speed: new Tensor("float32", [1], [1]),
    });
    const audio = new Float32Array(waveform.data as Float32Array);
    post({ type: "audio", id, audio, ms: Math.round(performance.now() - started) }, [audio.buffer]);
  } catch (error) {
    fail(error, id);
  }
};
