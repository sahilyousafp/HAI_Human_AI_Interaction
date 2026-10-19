/// <reference lib="webworker" />
// Runs hand and face tracking off the main thread. Camera frames arrive as transferred ImageBitmaps,
// are closed right after inference, and only pixel-free TrackingFrames are posted back.
import { AdaptiveScheduler, FrameSmoother, GestureRecognizer, toTrackingFrame } from "@aex/perception";
import { FaceLandmarker, FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { FromWorker, ToWorker } from "./messages.ts";

declare const self: DedicatedWorkerGlobalScope;

type Delegate = "GPU" | "CPU";

let hands: HandLandmarker | null = null;
let face: FaceLandmarker | null = null;
let backend: Delegate = "CPU";
let perfDelayMs = 0;
let sendRawHands = false;
const smoother = new FrameSmoother();
const scheduler = new AdaptiveScheduler();
const recognizer = new GestureRecognizer();

const post = (message: FromWorker) => self.postMessage(message);
const now = () => performance.timeOrigin + performance.now();

/**
 * True when WebGL is backed by a software rasteriser (SwiftShader, llvmpipe). MediaPipe's "GPU" delegate then
 * runs far slower than its CPU delegate (XNNPACK): about 1 fps versus 5+ on a CI runner without a GPU.
 */
function softwareWebGL(): boolean {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
    if (!gl) return true;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    return /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    return true;
  }
}

const preferGPU = !softwareWebGL();

/** Uses the GPU delegate on real GPUs and falls back to CPU if it fails or WebGL is software-only. */
async function withDelegate<T>(
  create: (delegate: Delegate) => Promise<T>,
): Promise<{ task: T; delegate: Delegate }> {
  if (preferGPU) {
    try {
      return { task: await create("GPU"), delegate: "GPU" };
    } catch {
      // fall through to CPU
    }
  }
  return { task: await create("CPU"), delegate: "CPU" };
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
    const raw = toTrackingFrame({
      seq,
      captureTs,
      inferenceDoneTs,
      backend,
      aspect: bitmap.width / bitmap.height,
      hands: handResult,
      ...(faceResult ? { face: faceResult } : {}),
    });
    const frame = smoother.smooth(raw);
    scheduler.frameDone(inferenceDoneTs);
    const inferenceMs = performance.now() - started;
    // Gestures are recognised here, right after smoothing, so they never wait on the main thread.
    const gestureStarted = performance.now();
    const gestures = recognizer.process(frame);
    const gestureMs = performance.now() - gestureStarted;
    post({
      type: "frame",
      frame,
      gestures,
      gestureState: recognizer.state,
      gestureMs,
      ...(sendRawHands ? { rawHands: raw.hands } : {}),
      inferenceMs,
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
  } else if (msg.type === "options") {
    sendRawHands = msg.rawHands;
  }
};
