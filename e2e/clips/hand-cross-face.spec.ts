import { expect, type Page, test } from "@playwright/test";
import { gestureEvents, startCamera } from "../tracking.ts";

/** The parts of a recorded tracking frame (apps/web LandmarkRecorder) this test reads. */
type TrackingFrame = {
  seq: number;
  captureTs: number;
  aspect?: number;
  hands: Array<{ handedness: "Left" | "Right"; image: number[][] }>;
};

// Plays test-assets/clips/hand-cross-face.mp4 (14.4 s): each hand pinches and sweeps across the face to the other
// side, then both hands pinch close together. Tracking loses the hands for a few frames in every sweep (motion
// blur, hand over face), and MediaPipe's per-frame handedness guess flips as a hand crosses: before hand identity
// and the tracking-loss grace, this clip flipped labels three times and fired a stray tap.

const CLIP_MS = 14_400;

/** Records smoothed frames (what the recogniser sees) for one full loop of the clip, however slow the machine. */
async function recordLoop(page: Page): Promise<TrackingFrame[]> {
  await page.evaluate(() => {
    const w = window as unknown as { __AEX_RECORDER__: { start(): void }; __AEX_GESTURES__?: unknown };
    w.__AEX_GESTURES__ = { events: [] };
    w.__AEX_RECORDER__.start();
  });
  await page.waitForTimeout(CLIP_MS + 500);
  return page.evaluate(() =>
    (window as unknown as { __AEX_RECORDER__: { stop(): TrackingFrame[] } }).__AEX_RECORDER__.stop(),
  );
}

const palm = (hand: TrackingFrame["hands"][number], aspect = 4 / 3): [number, number] => {
  const ids = [0, 5, 9, 13, 17];
  const x = ids.reduce((s, i) => s + (hand.image[i]?.[0] ?? 0), 0) / ids.length;
  const y = ids.reduce((s, i) => s + (hand.image[i]?.[1] ?? 0), 0) / ids.length;
  return [x, y / aspect];
};

test("a hand crossing the face keeps its label, two hands never share one, and no stray tap fires", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await startCamera(page);
  const frames = await recordLoop(page);
  expect(frames.filter((f) => f.hands.length > 0).length).toBeGreaterThan(30);

  // A hand in the same place as in the previous frame (within 0.1 of the frame width) must have the same label.
  const flips: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const [a, b] = [frames[i - 1] as TrackingFrame, frames[i] as TrackingFrame];
    if (b.captureTs - a.captureTs > 150) continue;
    for (const hand of b.hands) {
      const p = palm(hand, b.aspect);
      for (const prev of a.hands) {
        const q = palm(prev, a.aspect);
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.1 && prev.handedness !== hand.handedness)
          flips.push(b.seq);
      }
    }
  }
  expect(flips).toEqual([]);

  for (const f of frames) {
    if (f.hands.length === 2) expect(f.hands[0]?.handedness).not.toBe(f.hands[1]?.handedness);
  }

  // Every pinch in this clip is lost mid-sweep or held: none of them is a tap.
  expect((await gestureEvents(page)).filter((e) => e.type === "pinch.tap")).toEqual([]);
});
