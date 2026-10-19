/// <reference lib="webworker" />
// Runs hand and face tracking off the main thread. Camera frames arrive as transferred ImageBitmaps,
// are closed right after inference, and only pixel-free TrackingFrames are posted back.
import { AdaptiveScheduler, FrameSmoother, toTrackingFrame } from "@aex/perception";
import { FaceLandmarker, FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { FromWorker, ToWorker } from "./messages.ts";

declare const self: DedicatedWorkerGlobalScope;

type Delegate = "GPU" | "CPU";

let hands: HandLandmarker | null = null;
let face: FaceLandmarker | null = null;
let backend: Delegate = "CPU";
let perfDelayMs = 0;
const smoother = new FrameSmoother();
const scheduler = new AdaptiveScheduler();

const post = (message: FromWorker) => self.postMessage(message);
const now = () => performance.timeOrigin + performance.now();

/** Tries the GPU delegate first and falls back to CPU (e.g. headless CI, blocked WebGL). */
async function withDelegate<T>(
  create: (delegate: Delegate) => Promise<T>,
): Promise<{ task: T; delegate: Delegate }> {
  try {
    return { task: await create("GPU"), delegate: "GPU" };
  } catch {
    return { task: await create("CPU"), delegate: "CPU" };
  }
}

async function init(msg: Extract<ToWorker, { type: "init" }>) {
  perfDelayMs = msg.perfDelayMs;
  const vision = await FilesetResolver.forVisionTasks(msg.wasmBase, true);
  // With ES-module WASM, MediaPipe reads `self.ModuleFactory` set by the loader module's top level and then
  // clears it. A second import() of the same URL comes from the module cache and never re-sets it
  // ("ModuleFactory not set."), so every task loads the loader under its own URL.
  const filesetFor = (task: string) => ({
    ...vision,
    wasmLoaderPath: `${vision.wasmLoaderPath}?task=${task}`,
  });
  const handResult = await withDelegate((delegate) =>
    HandLandmarker.createFromOptions(filesetFor(`hand-${delegate}`), {
      baseOptions: { modelAssetPath: msg.handModel, delegate },
      runningMode: "VIDEO",
      numHands: 2,
    }),
  );
  const faceResult = await withDelegate((delegate) =>
    FaceLandmarker.createFromOptions(filesetFor(`face-${delegate}`), {
      baseOptions: { modelAssetPath: msg.faceModel, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    }),
  );
  hands = handResult.task;
  face = faceResult.task;
  backend = handResult.delegate === "GPU" && faceResult.delegate === "GPU" ? "GPU" : "CPU";
  post({ type: "ready", backend });
}

function onFrame(msg: Extract<ToWorker, { type: "frame" }>) {
  const { bitmap, seq, captureTs } = msg;
  try {
    if (!hands || !face) return;
    const started = performance.now();
    const handResult = hands.detectForVideo(bitmap, captureTs);
    const faceResult = scheduler.shouldRunFace(seq) ? face.detectForVideo(bitmap, captureTs) : undefined;
    if (perfDelayMs > 0) {
      const until = performance.now() + perfDelayMs;
      while (performance.now() < until) {
        // Simulated slow machine (tests only).
      }
    }
    const inferenceDoneTs = now();
    const frame = smoother.smooth(
      toTrackingFrame({
        seq,
        captureTs,
        inferenceDoneTs,
        backend,
        hands: handResult,
        ...(faceResult ? { face: faceResult } : {}),
      }),
    );
    scheduler.frameDone(inferenceDoneTs);
    post({
      type: "frame",
      frame,
      inferenceMs: performance.now() - started,
      faceRan: faceResult !== undefined,
      fps: scheduler.fps,
      faceCadence: scheduler.faceCadence,
    });
  } finally {
    bitmap.close();
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  if (msg.type === "init") {
    init(msg).catch((error: unknown) =>
      post({ type: "error", message: error instanceof Error ? error.message : String(error) }),
    );
  } else if (msg.type === "frame") {
    onFrame(msg);
  }
};
