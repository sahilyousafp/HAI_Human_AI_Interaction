import { VOICE } from "./voice-config.ts";
import type { Listener, ListenerEvents } from "./voice-input.ts";

const MICROPHONE: MediaStreamConstraints = {
  audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};
const stopTracks = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};

type Vad = Awaited<ReturnType<typeof import("@ricky0123/vad-web")["MicVAD"]["new"]>>;

/** The speech detector, loaded once and kept; `events` is the listening session it reports to now, if any. */
let detector: Promise<{ vad: Vad; route: { events: ListenerEvents | null } }> | null = null;

/**
 * Loads Silero VAD (vad-web, in an AudioWorklet) without opening the microphone. Loading takes a second or more, so
 * it is done before the first request (at first engagement) and kept: listening then starts at once.
 */
function loadDetector(): NonNullable<typeof detector> {
  detector ??= (async () => {
    const { MicVAD } = await import("@ricky0123/vad-web");
    const route: { events: ListenerEvents | null } = { events: null };
    const vad = await MicVAD.new({
      model: "v5",
      baseAssetPath: "/vad/",
      onnxWASMBasePath: "/ort/",
      startOnLoad: false,
      // The microphone opens when listening starts and every track stops when it pauses.
      getStream: () => navigator.mediaDevices.getUserMedia(MICROPHONE),
      pauseStream: async (stream) => stopTracks(stream),
      resumeStream: () => navigator.mediaDevices.getUserMedia(MICROPHONE),
      redemptionMs: VOICE.silenceMs,
      preSpeechPadMs: 300,
      // A one-syllable command ("Bake.", "Undo.") has less than 250 ms of voiced speech and was dropped as a misfire;
      // the microphone only opens on an explicit action, so a short floor costs little.
      minSpeechMs: 150,
      submitUserSpeechOnPause: true,
      onSpeechStart: () => route.events?.speechStart(),
      onSpeechEnd: (audio) => route.events?.speechEnd({ audio }),
      onFrameProcessed: (probabilities) => route.events?.level(probabilities.isSpeech),
      ortConfig: (ort) => {
        ort.env.logLevel = "error";
      },
    });
    return { vad, route };
  })();
  detector.catch(() => {
    detector = null;
  });
  return detector;
}

/** Loads the speech detector now, so the next listening session does not wait for it. Never opens the microphone. */
export function preloadOnDevice(): void {
  loadDetector().catch(() => {}); // a failure is reported when listening starts
}

/** Resolves once the speech detector is loaded (it starts loading it if nothing has). */
export async function detectorLoaded(): Promise<void> {
  await loadDetector();
}

/**
 * Listens on this machine: the speech detector finds where speech starts and ends and hands over the utterance as
 * 16 kHz samples. The model and ONNX runtime are served by the app (scripts/fetch-assets.mjs). The microphone stream
 * is ours, so ending a session always stops every track.
 */
export async function listenOnDevice(events: ListenerEvents): Promise<Listener> {
  const { vad, route } = await loadDetector();
  route.events = events;
  try {
    await vad.start();
  } catch (error) {
    // The detector is left errored (the microphone was refused or missing): the next session loads a new one.
    route.events = null;
    detector = null;
    vad.destroy().catch(() => {}); // a detector that never started has nothing to stop, and says so by throwing
    throw error;
  }
  // A session only ends itself: once a newer one has the detector, ending this one changes nothing.
  const current = () => route.events === events;
  return {
    finish: () => {
      // Delivers the speech so far (submitUserSpeechOnPause), then stops the tracks.
      if (current()) vad.pause().catch(() => {});
    },
    cancel: () => {
      if (!current()) return;
      route.events = null;
      vad.pause().catch(() => {});
    },
  };
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
