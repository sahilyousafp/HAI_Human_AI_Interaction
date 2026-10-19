import { matrixFromHeadPose } from "@aex/perception";
import type { TrackedHand, TrackingFrame, Vec3 } from "@aex/protocol";

/** Bone pairs of MediaPipe's 21-point hand model. */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

export interface DrawColors {
  left: string;
  right: string;
  face: string;
  axisX: string;
  axisY: string;
  axisZ: string;
  raw: string;
}

/** Image landmarks are unmirrored; the preview is mirrored, so x is flipped to line up with what the user sees. */
const toCanvas = (p: Vec3, w: number, h: number): [number, number] => [(1 - p[0]) * w, p[1] * h];

export function drawTracking(
  ctx: CanvasRenderingContext2D,
  frame: TrackingFrame | null,
  colors: DrawColors,
  rawHands: TrackedHand[] = [],
) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  if (!frame) return;

  // Unsmoothed points as faint hollow dots underneath, to show what smoothing removes.
  ctx.strokeStyle = colors.raw;
  ctx.lineWidth = 1;
  for (const hand of rawHands) {
    for (const p of hand.image) {
      const [x, y] = toCanvas(p, w, h);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (frame.face) {
    ctx.fillStyle = colors.face;
    for (const p of frame.face.landmarks) {
      const [x, y] = toCanvas(p, w, h);
      ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }
    drawHeadAxes(ctx, frame, colors, w, h);
  }

  for (const hand of frame.hands) {
    const color = hand.handedness === "Left" ? colors.left : colors.right;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = hand.image[a];
      const pb = hand.image[b];
      if (!pa || !pb) continue;
      const [ax, ay] = toCanvas(pa, w, h);
      const [bx, by] = toCanvas(pb, w, h);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    for (const p of hand.image) {
      const [x, y] = toCanvas(p, w, h);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawHeadAxes(
  ctx: CanvasRenderingContext2D,
  frame: TrackingFrame,
  colors: DrawColors,
  w: number,
  h: number,
) {
  const face = frame.face;
  const nose = face?.landmarks[1];
  if (!face || !nose) return;
  const m = matrixFromHeadPose(face.headPose).data;
  const [ox, oy] = toCanvas(nose, w, h);
  const len = Math.min(w, h) * 0.12;
  const axes: Array<[number, string]> = [
    [0, colors.axisX],
    [1, colors.axisY],
    [2, colors.axisZ],
  ];
  ctx.lineWidth = 3;
  for (const [col, color] of axes) {
    // Column `col` of the rotation is that axis in camera space (x right, y up). Mirror x and flip y for the canvas.
    const ax = m[col * 4] ?? 0;
    const ay = m[col * 4 + 1] ?? 0;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox - ax * len, oy - ay * len);
    ctx.stroke();
  }
}
