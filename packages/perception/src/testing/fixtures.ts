import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { TrackedHand, TrackingFrame } from "@aex/protocol";
import { z } from "zod";

export const FIXTURE_CLIPS = ["no-hands", "one-hand-pinch", "two-hands", "head-turn", "open-palm"] as const;
export type FixtureClip = (typeof FIXTURE_CLIPS)[number];

const fixtureDir = join(import.meta.dirname, "..", "..", "..", "..", "test-assets", "landmarks");

/** Loads and validates recorded tracking frames (see scripts/export-landmarks.mjs). Test use only. */
export function loadFixture(clip: FixtureClip): TrackingFrame[] {
  const raw = JSON.parse(gunzipSync(readFileSync(join(fixtureDir, `${clip}.json.gz`))).toString("utf8"));
  return z.array(TrackingFrame).parse(raw);
}

export const PinchLabel = z.strictObject({
  /** Judged by eye on the camera frame: fingertips touching, a near miss (a visible gap), or a fist. */
  label: z.enum(["touch", "near-miss", "fist"]),
  clip: z.string(),
  seq: z.number().int(),
  aspect: z.number(),
  hand: TrackedHand,
});
export type PinchLabel = z.infer<typeof PinchLabel>;

/**
 * Smoothed hands from the test clips, each labelled by looking at the camera frame it was tracked on
 * (test-assets/landmarks/pinch-labels.json.gz). The ground truth that the pinch thresholds are set against.
 */
export function loadPinchLabels(): PinchLabel[] {
  const raw = JSON.parse(gunzipSync(readFileSync(join(fixtureDir, "pinch-labels.json.gz"))).toString("utf8"));
  return z.array(PinchLabel).parse(raw);
}
