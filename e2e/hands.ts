// Driving the viewer by hand at points of the model: gestures placed at ground points in millimetres, the way the
// perception worker would send them for a hand over that spot.
import type { Page } from "@playwright/test";

export type Point = [number, number];

/** The sketches, the sketch being drawn and the lettered markers the viewer holds. */
export const references = (page: Page) =>
  page.evaluate(() => {
    const s = window.__HAI_TOOLS__?.references.getSnapshot();
    if (!s) throw new Error("tools not ready");
    return s;
  });

/** Where a ground point (mm) is in the view (0..1), if it is on the canvas and clear of panels by a margin. */
export async function viewerOf(page: Page, [x, y]: Point): Promise<Point | null> {
  return page.evaluate(
    ([x, y]) => {
      const canvas = document.querySelector("[data-testid=viewer] canvas");
      const rect = canvas?.getBoundingClientRect();
      const at = window.__HAI_VIEWER__?.project([x, y, 0]);
      if (!rect || !at) return null;
      const clear = [
        [0, 0],
        [40, 0],
        [-40, 0],
        [0, 40],
        [0, -40],
      ].every(
        ([dx = 0, dy = 0]) =>
          document.elementFromPoint(
            rect.left + at[0] * rect.width + dx,
            rect.top + at[1] * rect.height + dy,
          ) === canvas,
      );
      return clear ? (at as Point) : null;
    },
    [x, y] as const,
  );
}

/** Points every metre or so along the edges of a `w` by `h` mm rectangle from (x, y), and its centre. */
function outline(x: number, y: number, w: number, h: number): Point[] {
  const along = (from: Point, to: Point): Point[] => {
    const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 1000));
    return Array.from({ length: n }, (_, i) => [
      from[0] + ((to[0] - from[0]) * i) / n,
      from[1] + ((to[1] - from[1]) * i) / n,
    ]);
  };
  const corners: Point[] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  return [...corners.flatMap((c, i) => along(c, corners[(i + 1) % 4] as Point)), [x + w / 2, y + h / 2]];
}

/**
 * A corner on open ground (mm) from which a `w` by `h` mm rectangle is all on screen and clear of panels along its
 * edges; with `empty`, also with no element under those points (the site's own ground plate included).
 */
export async function openGround(
  page: Page,
  w: number,
  h: number,
  options: { empty?: boolean } = {},
): Promise<Point> {
  for (let y = -10_000; y <= 30_000; y += 2000) {
    for (let x = 30_000; x >= -20_000; x -= 2000) {
      const spots = outline(x, y, w, h);
      let all = true;
      for (const spot of spots) {
        const at = await viewerOf(page, spot);
        if (!at) all = false;
        else if (
          options.empty &&
          (await page.evaluate(([vx, vy]) => window.__HAI_VIEWER__?.pick(vx, vy), at)) !== null
        )
          all = false;
        if (!all) break;
      }
      if (all) return [x, y];
    }
  }
  throw new Error("no open ground in view");
}

/** Sends one hand's gestures, positioned at ground points (mm), 40 ms apart. */
export async function handGestures(
  page: Page,
  hand: "Left" | "Right",
  steps: Array<{ type: string; at: Point }>,
) {
  const events = [];
  let ts = await page.evaluate(() => performance.now());
  for (const step of steps) {
    const v = await viewerOf(page, step.at);
    if (!v) throw new Error(`${step.at} is not on screen`);
    const position = await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.handAt(x, y), v);
    ts += 40;
    events.push({ type: step.type, ts, confidence: 1, hand, position, delta: [0, 0] });
  }
  await page.evaluate((events) => window.__HAI_INPUT__?.gestures(events), events);
}

/** Draws through ground points (mm) with one hand, as one pinch-drag. */
export async function handDraw(page: Page, points: Point[], hand: "Left" | "Right" = "Left") {
  const [first, ...rest] = points;
  if (!first) return;
  await handGestures(page, hand, [
    { type: "pinch.drag.start", at: first },
    ...rest.map((at) => ({ type: "pinch.drag.update", at })),
    { type: "pinch.drag.end", at: points[points.length - 1] ?? first },
  ]);
}

/** Taps a ground point (mm) with one hand. */
export const handTap = (page: Page, at: Point, hand: "Left" | "Right" = "Left") =>
  handGestures(page, hand, [{ type: "pinch.tap", at }]);

/** Points every 250 mm along a run from a to b. */
export function run(a: Point, b: Point): Point[] {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 250));
  return Array.from({ length: n + 1 }, (_, i) => [
    a[0] + ((b[0] - a[0]) * i) / n,
    a[1] + ((b[1] - a[1]) * i) / n,
  ]);
}

/** One hand's gesture at a viewer position (0..1). */
export async function handEvent(page: Page, hand: "Left" | "Right", type: string, at: Point) {
  const position = await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.handAt(x, y), at);
  await page.evaluate((e) => window.__HAI_INPUT__?.gestures([{ confidence: 1, delta: [0, 0], ...e }]), {
    type,
    hand,
    position,
    ts: await page.evaluate(() => performance.now()),
  });
}

/**
 * A long pinch at a viewer position: the hand's pointer is there (as tracking sends it), then the pinch starts as a
 * drag that has not moved, and holds.
 */
export async function holdAt(page: Page, at: Point, hand: "Left" | "Right" = "Right") {
  const position = await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.handAt(x, y), at);
  await page.evaluate(
    ([p, h]) =>
      window.__HAI_INPUT__?.pointer(h === "Right" ? (p as Point) : null, h === "Left" ? (p as Point) : null),
    [position, hand] as const,
  );
  await handEvent(page, hand, "pinch.drag.start", at);
  await handEvent(page, hand, "pinch.hold", at);
}

/** The holding hand moves to `at` and lets go there. */
export async function releaseAt(page: Page, at: Point, hand: "Left" | "Right" = "Right") {
  await handEvent(page, hand, "pinch.drag.update", at);
  await handEvent(page, hand, "pinch.drag.end", at);
}

/** The tools' snapshot: the held target and the palette among it. */
export const toolSnapshot = (page: Page) =>
  page.evaluate(() => {
    const s = window.__HAI_TOOLS__?.getSnapshot() as unknown as {
      activeId: string;
      held: { target: { kind: string; id?: string; aid?: string | null }; hand: string } | null;
      palette: { ring: string; hand: string | null; hidden: boolean; highlighted: number | null } | null;
    };
    if (!s) throw new Error("tools not ready");
    return s;
  });
