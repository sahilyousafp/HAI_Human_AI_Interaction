import { describe, expect, it } from "vitest";
import { FACE_LANDMARK_COUNT, HAND_LANDMARK_COUNT, TrackingFrame, type Vec3 } from "./tracking.ts";

const points = (n: number): Vec3[] => Array.from({ length: n }, (_, i) => [i / n, 0.5, 0]);

const validFrame = {
  seq: 7,
  captureTs: 1_760_000_000_000,
  inferenceDoneTs: 1_760_000_000_012,
  backend: "GPU",
  hands: [
    {
      handedness: "Right",
      score: 0.97,
      image: points(HAND_LANDMARK_COUNT),
      world: points(HAND_LANDMARK_COUNT),
    },
  ],
  face: {
    landmarks: points(FACE_LANDMARK_COUNT),
    blendshapes: { jawOpen: 0.1, eyeBlinkLeft: 0.02 },
    headPose: { yaw: -12, pitch: 3, roll: 1 },
  },
};

describe("TrackingFrame", () => {
  it("accepts a valid frame with hands and face", () => {
    expect(TrackingFrame.safeParse(validFrame).success).toBe(true);
  });

  it("accepts a frame without a face (skipped under load)", () => {
    const { face: _face, ...withoutFace } = validFrame;
    expect(TrackingFrame.safeParse(withoutFace).success).toBe(true);
  });

  it.each([
    ["an image field on the frame", { ...validFrame, image: "data:image/png;base64,AAAA" }],
    ["pixels on a hand", { ...validFrame, hands: [{ ...validFrame.hands[0], pixels: [1, 2, 3] }] }],
    ["a crop on the face", { ...validFrame, face: { ...validFrame.face, crop: new Uint8Array(4) } }],
  ])("rejects unknown keys: %s", (_label, frame) => {
    expect(TrackingFrame.safeParse(frame).success).toBe(false);
  });

  it.each([
    [
      "three hands",
      { ...validFrame, hands: [validFrame.hands[0], validFrame.hands[0], validFrame.hands[0]] },
    ],
    ["20 hand landmarks", { ...validFrame, hands: [{ ...validFrame.hands[0], image: points(20) }] }],
    ["a blendshape above 1", { ...validFrame, face: { ...validFrame.face, blendshapes: { jawOpen: 1.5 } } }],
    ["an unknown backend", { ...validFrame, backend: "TPU" }],
  ])("rejects malformed data: %s", (_label, frame) => {
    expect(TrackingFrame.safeParse(frame).success).toBe(false);
  });
});
