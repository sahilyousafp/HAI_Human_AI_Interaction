// The hand HAI draws everywhere on the site: the 21 MediaPipe landmarks of an open right hand, the bones that
// join them, and an OK-sign pinch (thumb and index tips meeting) that the cursor and the header animate
// towards. The hero draws the same hand but moves it with the 3D rig in rig.ts. Used both when rendering the
// SVG and in the browser.

export type Pt = readonly [number, number];

/** viewBox that frames the hand with room for the hero's hover ring. */
export const VIEWBOX = "40 70 320 420";

export const OPEN: readonly Pt[] = [
  [200, 470],
  [150, 432],
  [112, 384],
  [88, 334],
  [70, 290],
  [156, 300],
  [146, 222],
  [141, 172],
  [138, 128],
  [200, 290],
  [201, 202],
  [202, 148],
  [203, 100],
  [243, 300],
  [252, 220],
  [257, 172],
  [261, 130],
  [282, 322],
  [300, 262],
  [311, 225],
  [320, 190],
];

// Only the thumb (1-4) and index (5-8) move; the other three fingers stay up, as in the OK sign the gesture
// recogniser asks for.
const PINCHED: readonly Pt[] = OPEN.map((p, i) => {
  const moved: Record<number, Pt> = {
    1: [150, 430],
    2: [124, 388],
    3: [110, 330],
    4: [116, 240],
    6: [148, 236],
    7: [130, 212],
    8: [118, 232],
  };
  return moved[i] ?? p;
});

export const BONES: readonly (readonly [number, number])[] = [
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
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

const WRIST = 0;
export const INDEX_TIP = 8;

// The solid hand, as the app draws it under "show my hands": a palm polygon plus a thick round-capped stroke
// along each finger, filled as one shape. Widths are in viewBox units.
export const PALM = [0, 1, 2, 5, 9, 13, 17] as const;
export const FINGERS: readonly { chain: readonly number[]; width: number }[] = [
  { chain: [1, 2, 3, 4], width: 44 },
  { chain: [5, 6, 7, 8], width: 38 },
  { chain: [9, 10, 11, 12], width: 39 },
  { chain: [13, 14, 15, 16], width: 36 },
  { chain: [17, 18, 19, 20], width: 31 },
];

function rotate([x, y]: Pt, [ox, oy]: Pt, deg: number): Pt {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return [ox + (x - ox) * c - (y - oy) * s, oy + (x - ox) * s + (y - oy) * c];
}

export interface PoseOptions {
  /** 0 open, 1 thumb and index tips meeting. */
  pinch?: number;
  /** Rotation about the wrist, in degrees. */
  deg?: number;
}

/** The 21 landmarks for a pose. */
export function pose({ pinch = 0, deg = 0 }: PoseOptions = {}): Pt[] {
  const p = Math.min(1, Math.max(0, pinch));
  const pts: Pt[] = OPEN.map(([x0, y0], i) => {
    const [x1, y1] = PINCHED[i];
    return [x0 + (x1 - x0) * p, y0 + (y1 - y0) * p];
  });
  return deg ? pts.map((q) => rotate(q, OPEN[WRIST], deg)) : pts;
}

/** Move an SVG drawn by HandSvg to a pose: bones (data-a/data-b), joints (data-j), shapes (data-pts). */
export function applyPose(svg: SVGSVGElement, pts: readonly Pt[]) {
  for (const s of svg.querySelectorAll<SVGPolygonElement | SVGPolylineElement>("[data-pts]")) {
    s.setAttribute(
      "points",
      (s.dataset.pts ?? "")
        .split(" ")
        .map((i) => pts[Number(i)].map((v) => v.toFixed(1)).join(","))
        .join(" "),
    );
  }
  for (const l of svg.querySelectorAll<SVGLineElement>("line[data-a]")) {
    const a = pts[Number(l.dataset.a)];
    const b = pts[Number(l.dataset.b)];
    l.setAttribute("x1", a[0].toFixed(1));
    l.setAttribute("y1", a[1].toFixed(1));
    l.setAttribute("x2", b[0].toFixed(1));
    l.setAttribute("y2", b[1].toFixed(1));
  }
  for (const c of svg.querySelectorAll<SVGCircleElement>("[data-j]")) {
    const p = pts[Number(c.dataset.j)];
    c.setAttribute("cx", p[0].toFixed(1));
    c.setAttribute("cy", p[1].toFixed(1));
  }
}

/**
 * A spring: moves towards the target with momentum, which reads as smoother than plain easing for things
 * that follow the hand. `ms` is roughly the settle time. At the default damping of 1 it never overshoots;
 * below 1 it overshoots a little and settles, for things that should land with a bit of give.
 */
export class Spring {
  value: number;
  target: number;
  private v = 0;
  constructor(
    initial: number,
    private ms: number,
    private damping = 1,
  ) {
    this.value = initial;
    this.target = initial;
  }
  step(dt: number) {
    const w = 8 / this.ms;
    // Small sub-steps keep a fast spring stable through a dropped frame.
    for (let left = dt; left > 0; left -= 4) {
      const h = Math.min(4, left);
      this.v += (-w * w * (this.value - this.target) - 2 * this.damping * w * this.v) * h;
      this.value += this.v * h;
    }
    return this.value;
  }
}

export const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
