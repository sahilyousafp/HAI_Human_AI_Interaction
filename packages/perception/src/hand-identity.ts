import type { Hand, TrackedHand, TrackingFrame, Vec3 } from "@hai/protocol";

/** A hand not seen for longer than this has left; when it returns it is labelled afresh. */
export const IDENTITY_LOST_MS = 300;
/** Farthest a hand's palm centre may move between frames (fraction of the frame width) and still be the same hand. */
export const IDENTITY_MAX_JUMP = 0.35;
/** Two detections whose palm centres are closer than this are the same hand reported twice... */
const DUPLICATE_DISTANCE = 0.04;
/**
 * ...as are two whose bounding boxes overlap by more than this share of the smaller box. On motion-blurred frames
 * MediaPipe sometimes fits a second, lower-scoring "ghost" hand inside the real one, with a misplaced wrist (seen on
 * test-assets/clips/hand-cross-face.mp4: 98% inside, palm centres 0.05 apart).
 */
const DUPLICATE_OVERLAP = 0.6;

// Wrist and the four finger knuckles: the palm, which moves least as the fingers pinch or curl.
const PALM = [0, 5, 9, 13, 17];

interface IdentityTrack {
  side: Hand;
  centre: [number, number];
  ts: number;
}

const other = (side: Hand): Hand => (side === "Left" ? "Right" : "Left");

function palmCentre(hand: TrackedHand, aspect: number): [number, number] {
  let x = 0;
  let y = 0;
  for (const i of PALM) {
    const p = hand.image[i] as Vec3;
    x += p[0];
    y += p[1];
  }
  // x in frame widths, y converted to the same unit so distances are isotropic.
  return [x / PALM.length, y / PALM.length / aspect];
}

const distance = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boundingBox(hand: TrackedHand): Box {
  const xs = hand.image.map((p) => p[0]);
  const ys = hand.image.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Intersection area as a share of the smaller box's area, 0..1. */
function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const area = (box: Box) => (box.x1 - box.x0) * (box.y1 - box.y0);
  const smaller = Math.min(area(a), area(b));
  return smaller === 0 ? 1 : (w * h) / smaller;
}

interface Detection {
  hand: TrackedHand;
  centre: [number, number];
  box: Box;
}

const sameHand = (a: Detection, b: Detection) =>
  distance(a.centre, b.centre) <= DUPLICATE_DISTANCE || overlap(a.box, b.box) > DUPLICATE_OVERLAP;

/**
 * Keeps each hand's Left/Right label stable from frame to frame. MediaPipe classifies handedness per frame from the
 * hand's appearance, and that guess fails when a hand crosses the face or comes near the other hand: it flips, or
 * both hands get the same label. Everything downstream (smoothing filters, pinch and drag state) is keyed by the
 * label, so a flip ends a drag, fires a stray tap, or blends two hands into one jumping hand.
 *
 * So a hand keeps the label it entered with for as long as it is tracked continuously (matched to its previous
 * position), two hands never share a label, and only a hand entering the view takes MediaPipe's label (or the
 * remaining one, if the other hand already holds it).
 */
export class HandIdentity {
  private tracks: IdentityTrack[] = [];

  assign(frame: TrackingFrame): TrackingFrame {
    const ts = frame.captureTs;
    const aspect = frame.aspect ?? 4 / 3;
    this.tracks = this.tracks.filter((t) => ts - t.ts <= IDENTITY_LOST_MS);

    // Drop a hand reported twice (overlapping detections), keeping the more confident one.
    const detections: Detection[] = [];
    for (const hand of [...frame.hands].sort((a, b) => b.score - a.score)) {
      const d = { hand, centre: palmCentre(hand, aspect), box: boundingBox(hand) };
      if (detections.length < 2 && !detections.some((kept) => sameHand(kept, d))) detections.push(d);
    }

    const sides: Array<Hand | null> = this.match(detections.map((d) => d.centre)).map((t) => t?.side ?? null);

    // New hands: MediaPipe's label unless the other hand holds it. Two new hands with the same label are told
    // apart by position: in the unmirrored camera image the user's right hand is on the left.
    const fresh = sides.flatMap((side, i) => (side === null ? [i] : []));
    if (fresh.length === 2 && detections[0]?.hand.handedness === detections[1]?.hand.handedness) {
      const [a, b] = fresh as [number, number];
      const aIsRight = (detections[a]?.centre[0] ?? 0) < (detections[b]?.centre[0] ?? 0);
      sides[a] = aIsRight ? "Right" : "Left";
      sides[b] = aIsRight ? "Left" : "Right";
    } else {
      for (const i of fresh) {
        const wanted = detections[i]?.hand.handedness ?? "Right";
        sides[i] = sides.includes(wanted) ? other(wanted) : wanted;
      }
    }

    const hands = detections.map((d, i) => ({ ...d.hand, handedness: sides[i] as Hand }));
    const current: IdentityTrack[] = detections.map((d, i) => ({
      side: sides[i] as Hand,
      centre: d.centre,
      ts,
    }));
    // A hand out of view keeps its track (for IDENTITY_LOST_MS) unless its label has been given to a visible hand.
    this.tracks = [...this.tracks.filter((t) => !current.some((c) => c.side === t.side)), ...current];
    return { ...frame, hands };
  }

  /** Best assignment of detections to existing tracks (at most two of each), within the jump limit. */
  private match(centres: Array<[number, number]>): Array<IdentityTrack | null> {
    let best: Array<IdentityTrack | null> = centres.map(() => null);
    let bestMatched = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    const tracks = this.tracks;
    const assign = (
      i: number,
      used: Set<IdentityTrack>,
      current: Array<IdentityTrack | null>,
      cost: number,
    ) => {
      if (i === centres.length) {
        const count = current.filter(Boolean).length;
        if (count > bestMatched || (count === bestMatched && cost < bestCost)) {
          best = [...current];
          bestMatched = count;
          bestCost = cost;
        }
        return;
      }
      assign(i + 1, used, [...current, null], cost);
      for (const track of tracks) {
        if (used.has(track)) continue;
        const d = distance(track.centre, centres[i] as [number, number]);
        if (d > IDENTITY_MAX_JUMP) continue;
        assign(i + 1, new Set([...used, track]), [...current, track], cost + d);
      }
    };
    assign(0, new Set(), [], 0);
    return best;
  }
}
