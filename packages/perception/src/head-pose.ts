import type { HeadPose } from "@hai/protocol";

/** MediaPipe's Matrix: rows, columns and data flattened in column-major order (MediaPipe's default layout). */
export interface FlatMatrix {
  rows: number;
  columns: number;
  data: ArrayLike<number>;
}

const DEG = 180 / Math.PI;

/**
 * Head pose from the facial transformation matrix (canonical face -> camera space; y up, camera looking down -z,
 * the face looking toward the camera along +z). The rotation is decomposed as R = Ry(yaw) * Rx(x) * Rz(roll):
 * - yaw: about the vertical axis; positive when the head turns toward the user's left (face forward moves to +x).
 * - pitch: positive when looking up (the negated x angle, since +x rotation tips the face down).
 * - roll: about the view axis; positive when the head tilts toward the user's right.
 */
export function headPoseFromMatrix(m: FlatMatrix): HeadPose {
  if (m.rows !== 4 || m.columns !== 4 || m.data.length !== 16) {
    throw new Error(`Expected a 4x4 matrix, got ${m.rows}x${m.columns} with ${m.data.length} values.`);
  }
  // Column-major: element (row r, column c) lives at data[c * 4 + r].
  const at = (r: number, c: number) => m.data[c * 4 + r] ?? 0;
  const xAngle = Math.asin(Math.max(-1, Math.min(1, -at(1, 2))));
  const yaw = Math.atan2(at(0, 2), at(2, 2));
  const roll = Math.atan2(at(1, 0), at(1, 1));
  return { yaw: yaw * DEG, pitch: -xAngle * DEG, roll: roll * DEG };
}

/** Builds the column-major 4x4 matrix for a head pose; the inverse of headPoseFromMatrix (used by tests and fixtures). */
export function matrixFromHeadPose(
  pose: HeadPose,
  translation: [number, number, number] = [0, 0, -50],
): FlatMatrix {
  const y = pose.yaw / DEG;
  const x = -pose.pitch / DEG;
  const z = pose.roll / DEG;
  const [cy, sy, cx, sx, cz, sz] = [
    Math.cos(y),
    Math.sin(y),
    Math.cos(x),
    Math.sin(x),
    Math.cos(z),
    Math.sin(z),
  ];
  // Rows of Ry * Rx * Rz.
  const r = [
    [cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx],
    [cx * sz, cx * cz, -sx],
    [-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx],
  ];
  const data = new Array<number>(16).fill(0);
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) data[col * 4 + row] = r[row]?.[col] ?? 0;
  data[12] = translation[0];
  data[13] = translation[1];
  data[14] = translation[2];
  data[15] = 1;
  return { rows: 4, columns: 4, data };
}
