import { z } from "zod";

export const HAND_LANDMARK_COUNT = 21;
export const FACE_LANDMARK_COUNT = 478;

/** [x, y, z]. Image landmarks are normalised to 0..1 of the frame; world landmarks are metres. */
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export const TrackedHand = z.strictObject({
  handedness: z.enum(["Left", "Right"]),
  score: z.number().min(0).max(1),
  image: z.array(Vec3).length(HAND_LANDMARK_COUNT),
  world: z.array(Vec3).length(HAND_LANDMARK_COUNT),
});
export type TrackedHand = z.infer<typeof TrackedHand>;

/** Degrees. Yaw positive = head turned to the user's left, pitch positive = looking up, roll positive = tilted right. */
export const HeadPose = z.strictObject({
  yaw: z.number(),
  pitch: z.number(),
  roll: z.number(),
});
export type HeadPose = z.infer<typeof HeadPose>;

export const TrackedFace = z.strictObject({
  landmarks: z.array(Vec3).length(FACE_LANDMARK_COUNT),
  blendshapes: z.record(z.string(), z.number().min(0).max(1)),
  headPose: HeadPose,
});
export type TrackedFace = z.infer<typeof TrackedFace>;

/**
 * One camera frame's measurements, as posted by the perception worker.
 * Deliberately has no field that could carry pixels: camera images never leave the worker.
 * Timestamps are epoch milliseconds (performance.timeOrigin + performance.now()).
 */
export const TrackingFrame = z.strictObject({
  seq: z.int().nonnegative(),
  captureTs: z.number().positive(),
  inferenceDoneTs: z.number().positive(),
  backend: z.enum(["GPU", "CPU"]),
  /** Camera frame width / height, needed to measure image-space distances. Absent means 4:3. */
  aspect: z.number().positive().optional(),
  hands: z.array(TrackedHand).max(2),
  /** Absent on frames where face tracking was skipped to keep hands responsive. */
  face: TrackedFace.optional(),
});
export type TrackingFrame = z.infer<typeof TrackingFrame>;
