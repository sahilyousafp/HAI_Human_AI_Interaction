import { FACE_LANDMARK_COUNT, HAND_LANDMARK_COUNT, TrackingFrame } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { matrixFromHeadPose } from "./head-pose.ts";
import { type MpHandResult, type MpLandmark, toTrackingFrame } from "./mediapipe-adapter.ts";

const lm = (n: number): MpLandmark[] => Array.from({ length: n }, (_, i) => ({ x: i / n, y: 0.5, z: 0 }));
const hand = (label: string): MpHandResult => ({
  landmarks: [lm(HAND_LANDMARK_COUNT)],
  worldLandmarks: [lm(HAND_LANDMARK_COUNT)],
  handedness: [[{ categoryName: label, score: 0.95 }]],
});
const base = {
  seq: 1,
  captureTs: 1_760_000_000_000,
  inferenceDoneTs: 1_760_000_000_015,
  backend: "GPU" as const,
};

describe("toTrackingFrame", () => {
  it("keeps MediaPipe's handedness for unmirrored input (verified on recorded footage)", () => {
    expect(toTrackingFrame({ ...base, hands: hand("Left") }).hands[0]?.handedness).toBe("Left");
    expect(toTrackingFrame({ ...base, hands: hand("Right") }).hands[0]?.handedness).toBe("Right");
  });

  it("swaps labels when frames are mirrored before inference", () => {
    expect(toTrackingFrame({ ...base, hands: hand("Left"), inputMirrored: true }).hands[0]?.handedness).toBe(
      "Right",
    );
  });

  it("produces a frame that validates against the schema, with face and head pose", () => {
    const frame = toTrackingFrame({
      ...base,
      hands: hand("Left"),
      face: {
        faceLandmarks: [lm(FACE_LANDMARK_COUNT)],
        faceBlendshapes: [
          {
            categories: [
              { categoryName: "jawOpen", score: 0.3 },
              { categoryName: "_neutral", score: 1.0000001 },
            ],
          },
        ],
        facialTransformationMatrixes: [matrixFromHeadPose({ yaw: 20, pitch: -5, roll: 2 })],
      },
    });
    expect(TrackingFrame.safeParse(frame).success).toBe(true);
    expect(frame.face?.headPose.yaw).toBeCloseTo(20, 6);
    expect(frame.face?.blendshapes._neutral).toBe(1);
  });

  it("omits the face when face tracking did not run", () => {
    const frame = toTrackingFrame({ ...base, hands: { landmarks: [], worldLandmarks: [], handedness: [] } });
    expect(frame.face).toBeUndefined();
    expect(frame.hands).toEqual([]);
  });
});
