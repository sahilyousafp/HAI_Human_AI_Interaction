import { describe, expect, it } from "vitest";
import { headPoseFromMatrix, matrixFromHeadPose } from "./head-pose.ts";

const rotate = (m: ReturnType<typeof matrixFromHeadPose>, v: [number, number, number]) =>
  [0, 1, 2].map((r) => (m.data[r] ?? 0) * v[0] + (m.data[4 + r] ?? 0) * v[1] + (m.data[8 + r] ?? 0) * v[2]);

describe("headPoseFromMatrix", () => {
  it.each([
    ["yaw +30", { yaw: 30, pitch: 0, roll: 0 }],
    ["yaw -30", { yaw: -30, pitch: 0, roll: 0 }],
    ["pitch +30", { yaw: 0, pitch: 30, roll: 0 }],
    ["pitch -30", { yaw: 0, pitch: -30, roll: 0 }],
    ["roll +30", { yaw: 0, pitch: 0, roll: 30 }],
    ["roll -30", { yaw: 0, pitch: 0, roll: -30 }],
    ["combined", { yaw: 25, pitch: -15, roll: 10 }],
  ])("recovers %s", (_label, pose) => {
    const got = headPoseFromMatrix(matrixFromHeadPose(pose));
    expect(got.yaw).toBeCloseTo(pose.yaw, 6);
    expect(got.pitch).toBeCloseTo(pose.pitch, 6);
    expect(got.roll).toBeCloseTo(pose.roll, 6);
  });

  it("reads the identity matrix as a neutral pose", () => {
    const identity = { rows: 4, columns: 4, data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
    const pose = headPoseFromMatrix(identity);
    expect(Math.abs(pose.yaw) + Math.abs(pose.pitch) + Math.abs(pose.roll)).toBeCloseTo(0, 9);
  });

  it("follows the documented sign conventions", () => {
    // Turning toward the user's left swings the face's forward axis (+z) toward +x.
    expect(rotate(matrixFromHeadPose({ yaw: 30, pitch: 0, roll: 0 }), [0, 0, 1])[0]).toBeGreaterThan(0);
    // Looking up raises the forward axis (+y).
    expect(rotate(matrixFromHeadPose({ yaw: 0, pitch: 30, roll: 0 }), [0, 0, 1])[1]).toBeGreaterThan(0);
    // Tilting toward the user's right moves the top of the head (+y) toward -x in camera space.
    expect(rotate(matrixFromHeadPose({ yaw: 0, pitch: 0, roll: 30 }), [0, 1, 0])[0]).toBeLessThan(0);
  });

  it("rejects a matrix that is not 4x4", () => {
    expect(() => headPoseFromMatrix({ rows: 3, columns: 3, data: new Array(9).fill(0) })).toThrow(/4x4/);
  });
});
