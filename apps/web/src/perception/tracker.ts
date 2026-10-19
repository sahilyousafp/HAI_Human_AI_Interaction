import type { RecognizerState } from "@aex/perception";
import type { GestureEvent, TrackedHand, TrackingFrame } from "@aex/protocol";
import { type CameraEffectsState, disableEffects, EFFECTS_OFF, readEffects } from "./camera-effects.ts";
import type { FromWorker, ToWorker } from "./messages.ts";

export type CameraError = "denied" | "not-found" | "in-use" | "unknown";

export type TrackerState =
  | { camera: "off" }
  | { camera: "starting" }
  | { camera: "on"; backend: "GPU" | "CPU" | null }
  | { camera: "error"; error: CameraError; detail: string };

export interface TrackerStats {
  frames: number;
  dropped: number;
  fps: number | null;
  inferenceMs: number;
  faceCadence: 1 | 2;
}

export interface TrackerCallbacks {
  onState(state: TrackerState): void;
  onFrame(frame: TrackingFrame, stats: TrackerStats, faceRan: boolean, rawHands?: TrackedHand[]): void;
  onGestures(events: GestureEvent[], state: RecognizerState, gestureMs: number): void;
  /** Operating-system camera effects (background blur, framing, eye contact) after asking for them off. */
  onEffects?(state: CameraEffectsState): void;
}

function classify(error: unknown): CameraError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "not-found";
  if (name === "NotReadableError" || name === "AbortError") return "in-use";
  return "unknown";
}

/**
 * Owns the camera stream and the perception worker. Frames are grabbed with requestVideoFrameCallback
 * (capture timestamps) and sent to the worker newest-frame-wins: if the worker is busy, the frame is dropped.
 */
export class Tracker {
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private callbackId: number | null = null;
  private busy = false;
  private seq = 0;
  private stats: TrackerStats = { frames: 0, dropped: 0, fps: null, inferenceMs: 0, faceCadence: 1 };
  private backend: "GPU" | "CPU" | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly callbacks: TrackerCallbacks,
    private readonly options: { perfDelayMs?: number } = {},
  ) {}

  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  private rawHands = false;

  /** Debug: ask the worker to also send unsmoothed hand points. */
  setRawHands(enabled: boolean): void {
    this.rawHands = enabled;
    this.worker?.postMessage({ type: "options", rawHands: enabled } satisfies ToWorker);
  }

  async start(): Promise<void> {
    if (this.stream) return;
    this.callbacks.onState({ camera: "starting" });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
          ...EFFECTS_OFF,
        } as MediaTrackConstraints,
        audio: false,
      });
    } catch (error) {
      this.callbacks.onState({ camera: "error", error: classify(error), detail: String(error) });
      return;
    }
    const track = this.stream.getVideoTracks()[0];
    if (track) {
      void disableEffects(track).then((effects) => {
        if (this.stream) this.callbacks.onEffects?.(effects);
      });
      // The user can switch effects on from the operating system while the camera runs.
      track.addEventListener("configurationchange", () => this.callbacks.onEffects?.(readEffects(track)));
    }
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    this.startWorker();
    this.callbacks.onState({ camera: "on", backend: this.backend });
    this.scheduleFrame();
  }

  stop(): void {
    this.release();
    this.callbacks.onState({ camera: "off" });
  }

  /** Stops the camera and worker after a failure, leaving the error state visible. */
  private fail(detail: string): void {
    console.error("[aex] tracking failed:", detail);
    this.release();
    this.callbacks.onState({ camera: "error", error: "unknown", detail });
  }

  private release(): void {
    if (this.callbackId !== null) this.video.cancelVideoFrameCallback(this.callbackId);
    this.callbackId = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.backend = null;
  }

  private startWorker() {
    this.worker = new Worker(new URL("./perception.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.onWorkerMessage(event.data);
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail(event.message || "The perception worker crashed.");
    };
    const init: ToWorker = {
      type: "init",
      wasmBase: `${location.origin}/mediapipe/wasm`,
      handModel: `${location.origin}/models/hand_landmarker.task`,
      faceModel: `${location.origin}/models/face_landmarker.task`,
      perfDelayMs: this.options.perfDelayMs ?? 0,
    };
    this.busy = true; // nothing is sent until the models are ready
    this.worker.postMessage(init);
    if (this.rawHands) this.worker.postMessage({ type: "options", rawHands: true } satisfies ToWorker);
  }

  private onWorkerMessage(msg: FromWorker) {
    if (msg.type === "ready") {
      this.backend = msg.backend;
      this.busy = false;
      if (this.stream) this.callbacks.onState({ camera: "on", backend: msg.backend });
    } else if (msg.type === "frame") {
      this.busy = false;
      this.stats = {
        ...this.stats,
        frames: this.stats.frames + 1,
        fps: msg.fps,
        inferenceMs: msg.inferenceMs,
        faceCadence: msg.faceCadence,
      };
      this.callbacks.onFrame(msg.frame, this.stats, msg.faceRan, msg.rawHands);
      this.callbacks.onGestures(msg.gestures, msg.gestureState, msg.gestureMs);
    } else {
      this.fail(msg.message);
    }
  }

  private scheduleFrame() {
    this.callbackId = this.video.requestVideoFrameCallback((nowMs, metadata) => {
      void this.onVideoFrame(metadata.captureTime ?? nowMs);
      if (this.stream) this.scheduleFrame();
    });
  }

  private async onVideoFrame(captureHighRes: number) {
    if (!this.worker) return;
    if (this.busy) {
      this.stats.dropped += 1;
      return;
    }
    this.busy = true;
    const bitmap = await createImageBitmap(this.video);
    if (!this.worker) {
      bitmap.close();
      return;
    }
    const message: ToWorker = {
      type: "frame",
      seq: this.seq++,
      captureTs: performance.timeOrigin + captureHighRes,
      bitmap,
    };
    this.worker.postMessage(message, [bitmap]);
  }
}
