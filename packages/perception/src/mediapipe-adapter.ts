import type { TrackedFace, TrackedHand, TrackingFrame, Vec3 } from "@hai/protocol";
import { type FlatMatrix, headPoseFromMatrix } from "./head-pose.ts";

// Structural copies of the MediaPipe result shapes we read, so this package stays free of the MediaPipe runtime.
export interface MpLandmark {
  x: number;
  y: number;
  z: number;
}
export interface MpCategory {
  categoryName: string;
  score: number;
}
export interface MpHandResult {
  landmarks: MpLandmark[][];
  worldLandmarks: MpLandmark[][];
  handedness: MpCategory[][];
}
export interface MpFaceResult {
  faceLandmarks: MpLandmark[][];
  faceBlendshapes: { categories: MpCategory[] }[];
  facialTransformationMatrixes?: FlatMatrix[];
}

export interface FrameInput {
  seq: number;
  captureTs: number;
  inferenceDoneTs: number;
  backend: "GPU" | "CPU";
  /** Frame width / height. */
  aspect?: number;
  hands: MpHandResult;
  face?: MpFaceResult;
  /**
   * The Tasks API labels handedness correctly for unmirrored camera frames, which is what we feed it
   * (verified on recorded footage: a raised right hand is reported as "Right"; the legacy Solutions docs'
   * "assumes a mirrored image" note does not apply). Set true only if frames are mirrored before inference.
   */
  inputMirrored?: boolean;
}

const vec = (p: MpLandmark): Vec3 => [p.x, p.y, p.z];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function toHands(result: MpHandResult, inputMirrored: boolean): TrackedHand[] {
  const hands: TrackedHand[] = [];
  const count = Math.min(2, result.landmarks.length);
  for (let i = 0; i < count; i++) {
    const category = result.handedness[i]?.[0];
    const image = result.landmarks[i];
    const world = result.worldLandmarks[i];
    if (!category || !image || !world) continue;
    const reported = category.categoryName === "Left" ? "Left" : "Right";
    const swapped = reported === "Left" ? "Right" : "Left";
    const handedness = inputMirrored ? swapped : reported;
    hands.push({ handedness, score: clamp01(category.score), image: image.map(vec), world: world.map(vec) });
  }
  return hands;
}

function toFace(result: MpFaceResult | undefined): TrackedFace | undefined {
  const landmarks = result?.faceLandmarks[0];
  const matrix = result?.facialTransformationMatrixes?.[0];
  if (!result || !landmarks || !matrix) return undefined;
  const blendshapes: Record<string, number> = {};
  for (const c of result.faceBlendshapes[0]?.categories ?? []) {
    if (c.categoryName) blendshapes[c.categoryName] = clamp01(c.score);
  }
  return { landmarks: landmarks.map(vec), blendshapes, headPose: headPoseFromMatrix(matrix) };
}

/** Converts raw MediaPipe results into the pixel-free tracking frame that leaves the worker. */
export function toTrackingFrame(input: FrameInput): TrackingFrame {
  const face = toFace(input.face);
  return {
    seq: input.seq,
    captureTs: input.captureTs,
    inferenceDoneTs: input.inferenceDoneTs,
    backend: input.backend,
    ...(input.aspect ? { aspect: input.aspect } : {}),
    hands: toHands(input.hands, input.inputMirrored ?? false),
    ...(face ? { face } : {}),
  };
}
