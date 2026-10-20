import { VOICE } from "./voice-config.ts";
import type { Listener, ListenerEvents } from "./voice-input.ts";

/**
 * Listens on this machine: Silero VAD (vad-web, in an AudioWorklet) finds where speech starts and ends and hands
 * over the utterance as 16 kHz samples. The model and ONNX runtime are served by the app (scripts/fetch-assets.mjs).
 * The microphone stream is ours, so cancelling always stops every track.
 */
export async function listenOnDevice(events: ListenerEvents): Promise<Listener> {
  const { MicVAD } = await import("@ricky0123/vad-web");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const stop = () => {
    for (const track of stream.getTracks()) track.stop();
  };
  try {
    const vad = await MicVAD.new({
      model: "v5",
      baseAssetPath: "/vad/",
      onnxWASMBasePath: "/ort/",
      startOnLoad: false,
      getStream: async () => stream,
      pauseStream: async () => {},
      redemptionMs: VOICE.silenceMs,
      preSpeechPadMs: 300,
      minSpeechMs: 250,
      submitUserSpeechOnPause: true,
      onSpeechStart: () => events.speechStart(),
      onSpeechEnd: (audio) => events.speechEnd({ audio }),
      onFrameProcessed: (probabilities) => events.level(probabilities.isSpeech),
      ortConfig: (ort) => {
        ort.env.logLevel = "error";
      },
    });
    await vad.start();
    return {
      finish: () => void vad.pause(), // delivers the speech so far (submitUserSpeechOnPause)
      cancel: () => {
        void vad.destroy();
        stop();
      },
    };
  } catch (error) {
    stop();
    throw error;
  }
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onspeechstart: (() => void) | null;
  onresult:
    | ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onaudiostart: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** The speech service's errors, as the getUserMedia error names the voice controller maps to messages. */
const CLOUD_ERRORS: Record<string, string> = {
  "not-allowed": "NotAllowedError",
  "audio-capture": "NotFoundError",
};

/** Whether the browser offers a cloud speech service at all. */
export function cloudSpeechAvailable(): boolean {
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

/**
 * Listens through the browser's speech service (opt-in): the browser sends the audio to its vendor's servers and
 * returns text. Only used when the user chose it in the Voice settings.
 */
export function listenInCloud(events: ListenerEvents): Promise<Listener> {
  const Recognition = ((window as unknown as Record<string, unknown>).SpeechRecognition ??
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined;
  if (!Recognition)
    return Promise.reject(Object.assign(new Error("No speech service"), { name: "NotFoundError" }));
  return new Promise((resolve, reject) => {
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    let text = "";
    let started = false;
    let cancelled = false;
    const listener: Listener = {
      finish: () => recognition.stop(),
      cancel: () => {
        cancelled = true;
        recognition.abort();
      },
    };
    recognition.onaudiostart = () => {
      started = true;
      resolve(listener);
    };
    recognition.onspeechstart = () => events.speechStart();
    recognition.onresult = (event) => {
      text = Array.from(event.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ");
    };
    recognition.onerror = (event) => {
      if (started) return; // after the microphone started, an error just ends the utterance (onend)
      reject(Object.assign(new Error(event.error), { name: CLOUD_ERRORS[event.error] ?? "Error" }));
    };
    recognition.onend = () => {
      if (started && !cancelled) events.speechEnd({ text });
    };
    recognition.start();
  });
}
