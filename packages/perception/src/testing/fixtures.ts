import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { TrackingFrame } from "@aex/protocol";
import { z } from "zod";

export const FIXTURE_CLIPS = ["no-hands", "one-hand-pinch", "two-hands", "head-turn", "open-palm"] as const;
export type FixtureClip = (typeof FIXTURE_CLIPS)[number];

const fixtureDir = join(import.meta.dirname, "..", "..", "..", "..", "test-assets", "landmarks");

/** Loads and validates recorded tracking frames (see scripts/export-landmarks.mjs). Test use only. */
export function loadFixture(clip: FixtureClip): TrackingFrame[] {
  const raw = JSON.parse(gunzipSync(readFileSync(join(fixtureDir, `${clip}.json.gz`))).toString("utf8"));
  return z.array(TrackingFrame).parse(raw);
}
