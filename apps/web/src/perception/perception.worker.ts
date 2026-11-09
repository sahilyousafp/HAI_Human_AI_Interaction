/// <reference lib="webworker" />
// Runs hand and face tracking off the main thread (the face only while the page asks for it). Camera frames arrive as
// transferred ImageBitmaps, are closed right after inference, and only pixel-free TrackingFrames are posted back.
import {
  AdaptiveScheduler,
  FrameSmoother,
  GestureRecognizer,
  HandIdentity,
  toTrackingFrame,
} from "@hai/perception";
import { FaceLandmarker, FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { isSoftwareRenderer } from "../gpu.ts";
import { shouldFallBackToCpu } from "./gpu-fallback.ts";
import type { FromWorker, ToWorker } from "./messages.ts";

declare const self: DedicatedWorkerGlobalScope;

type Delegate = "GPU" | "CPU";

let hands: HandLandmarker | null = null;
let face: FaceLandmarker | null = null;
let backend: Delegate = "CPU";
let perfDelayMs = 0;
let sendRawHands = false;
let mirrored = false;
/** The page wants head tracking: something waits for a nod or a shake. The face model stays loaded either way. */
let faceWanted = false;
let flipCanvas: OffscreenCanvas | null = null;
let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
let handModel = "";
let faceModel = "";
/** Frames processed without finding a hand, and whether one has ever been found. */
let emptyFrames = 0;
let everFoundHand = false;
let fellBack = false;
const identity = new HandIdentity();
const smoother = new FrameSmoother();
const scheduler = new AdaptiveScheduler();
const recognizer = new GestureRecognizer();

const post = (message: FromWorker) => self.postMessage(message);
const now = () => performance.timeOrigin + performance.now();

const preferGPU = !isSoftwareRenderer();

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

// With ES-module WASM, MediaPipe reads `self.ModuleFactory` set by the loader module's top level and then
// clears it. A second import() of the same URL comes from the module cache and never re-sets it
// ("ModuleFactory not set."), so every task loads the loader under its own URL.
function filesetFor(task: string) {
  if (!fileset) throw new Error("The vision fileset is not loaded.");
  return { ...fileset, wasmLoaderPath: `${fileset.wasmLoaderPath}?task=${task}` };
}

function createHand(delegate: Delegate): Promise<HandLandmarker> {
  return HandLandmarker.createFromOptions(filesetFor(`hand-${delegate}`), {
    baseOptions: { modelAssetPath: handModel, delegate },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

function createFace(delegate: Delegate): Promise<FaceLandmarker> {
  return FaceLandmarker.createFromOptions(filesetFor(`face-${delegate}`), {
    baseOptions: { modelAssetPath: faceModel, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
}

async function init(msg: Extract<ToWorker, { type: "init" }>) {
  perfDelayMs = msg.perfDelayMs;
  handModel = msg.handModel;
  faceModel = msg.faceModel;
  fileset = await FilesetResolver.forVisionTasks(msg.wasmBase, true);
  // Hands first: they drive the pointer and every gesture, so the camera becomes useful without waiting for the
  // (larger, slower to start) face model.
  const handResult = await withDelegate(createHand);
  hands = handResult.task;
  backend = handResult.delegate;
  post({ type: "ready", backend });
  // The face joins when it is ready. Head tracking is an extra: a face model that fails must not cost the hands.
  void (async () => {
    try {
      face = (await withDelegate(createFace)).task;
    } catch (error) {
      console.warn("[hai] face tracking is off:", error);
    }
  })();
}

/**
 * Rebuilds the hand model on the CPU once, for GPUs whose driver starts the graph but returns no landmarks. Frames are
 * dropped while `hands` is null.
 */
async function fallBackToCpu(reason: unknown): Promise<void> {
  fellBack = true;
  console.warn("[hai] the GPU delegate is not finding hands; switching to the CPU delegate.", reason);
  hands = null;
  try {
    hands = await createHand("CPU");
    backend = "CPU";
    post({ type: "ready", backend });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Tracking expects the unmirrored image a camera normally sends: MediaPipe's handedness and every downstream
 * convention (pointer, head yaw, palm direction) depend on it. A mirrored camera's frame is flipped back first.
 */
function unmirrored(bitmap: ImageBitmap): ImageBitmap {
  if (!mirrored) return bitmap;
  if (flipCanvas?.width !== bitmap.width || flipCanvas.height !== bitmap.height) {
    flipCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  }
  const ctx = flipCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  ctx.setTransform(-1, 0, 0, 1, bitmap.width, 0);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return flipCanvas.transferToImageBitmap();
}

function onFrame(msg: Extract<ToWorker, { type: "frame" }>) {
  const { seq, captureTs } = msg;
  const bitmap = unmirrored(msg.bitmap);
  try {
    if (!hands) return;
    const started = performance.now();
    let handResult: ReturnType<HandLandmarker["detectForVideo"]>;
    try {
      handResult = hands.detectForVideo(bitmap, captureTs);
    } catch (error) {
      if (backend === "GPU" && !fellBack) {
        void fallBackToCpu(error);
      } else {
        console.warn("[hai] hand tracking failed on this frame:", error);
      }
      return;
    }
    if (handResult.landmarks.length > 0) {
      everFoundHand = true;
    } else {
      emptyFrames += 1;
      if (shouldFallBackToCpu({ backend, fellBack, everFoundHand, emptyFrames })) {
        void fallBackToCpu("no hands");
      }
    }
    const faceResult =
      face && faceWanted && scheduler.shouldRunFace(seq) ? face.detectForVideo(bitmap, captureTs) : undefined;
    if (perfDelayMs > 0) {
      const until = performance.now() + perfDelayMs;
      while (performance.now() < until) {
        // Simulated slow machine (tests only).
      }
    }
    const inferenceDoneTs = now();
    // Stable Left/Right labels first: smoothing and gesture state are keyed by them.
    const raw = identity.assign(
      toTrackingFrame({
        seq,
        captureTs,
        inferenceDoneTs,
        backend,
        aspect: bitmap.width / bitmap.height,
        hands: handResult,
        ...(faceResult ? { face: faceResult } : {}),
      }),
    );
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
    if (msg.rawHands !== undefined) sendRawHands = msg.rawHands;
    if (msg.mirrored !== undefined) mirrored = msg.mirrored;
    if (msg.face !== undefined) faceWanted = msg.face;
  }
};
