import type { RecognizerState } from "@aex/perception";
import type { GestureEvent, TrackedHand, TrackingFrame } from "@aex/protocol";

/** Messages between the main thread and the perception worker. Camera images only ever travel inward. */
export type ToWorker =
  | {
      type: "init";
      wasmBase: string;
      handModel: string;
      faceModel: string;
      /** Test hook: busy-wait this long per frame to simulate a slow machine. 0 in normal use. */
      perfDelayMs: number;
    }
  | { type: "frame"; seq: number; captureTs: number; bitmap: ImageBitmap }
  /** Debug: also send the unsmoothed hand points, to compare against the smoothed ones. */
  | { type: "options"; rawHands: boolean };

export type FromWorker =
  | { type: "ready"; backend: "GPU" | "CPU" }
  | {
      type: "frame";
      frame: TrackingFrame;
      /** Gesture events produced by this frame, in order. */
      gestures: GestureEvent[];
      gestureState: RecognizerState;
      /** Time spent in the gesture recogniser for this frame. */
      gestureMs: number;
      /** Unsmoothed hands, only while the raw-points debug option is on. */
      rawHands?: TrackedHand[];
      inferenceMs: number;
      /** Whether face tracking ran on this frame (it may run and find no face). */
      faceRan: boolean;
      fps: number | null;
      faceCadence: 1 | 2;
    }
  | { type: "error"; message: string };
