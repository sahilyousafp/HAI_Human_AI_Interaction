// Records smoothed tracking frames from each test clip into test-assets/landmarks/<clip>.json.gz,
// so gesture recognisers can be unit-tested on real hands without a browser.
// Requires `pnpm dev` running. Usage: node scripts/export-landmarks.mjs [clip ...]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { buildClips } from "./convert-clips.mjs";

const root = join(import.meta.dirname, "..");
const APP = "http://127.0.0.1:5173/";
const out = join(root, "test-assets", "landmarks");

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
const roundPoints = (points, digits) => points.map((p) => p.map((v) => round(v, digits)));

/** Rounds coordinates so fixtures stay small; precision stays well below landmark jitter. */
function compact(frame) {
  return {
    ...frame,
    captureTs: round(frame.captureTs, 2),
    inferenceDoneTs: round(frame.inferenceDoneTs, 2),
    hands: frame.hands.map((h) => ({
      ...h,
      score: round(h.score, 3),
      image: roundPoints(h.image, 4),
      world: roundPoints(h.world, 4),
    })),
    ...(frame.face
      ? {
          face: {
            landmarks: roundPoints(frame.face.landmarks, 3),
            blendshapes: Object.fromEntries(
              Object.entries(frame.face.blendshapes).map(([k, v]) => [k, round(v, 3)]),
            ),
            headPose: Object.fromEntries(
              Object.entries(frame.face.headPose).map(([k, v]) => [k, round(v, 2)]),
            ),
          },
        }
      : {}),
  };
}

const durationOf = (clip) =>
  Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        join(root, "test-assets", "clips", `${clip}.mp4`),
      ],
      { encoding: "utf8" },
    ).trim(),
  );

try {
  await fetch(APP);
} catch {
  console.error("The web app is not running. Start `pnpm dev` first.");
  process.exit(2);
}

const clipDir = join(root, ".aex", "clips");
const wanted = process.argv.slice(2);
const clips = buildClips(clipDir).filter((c) => wanted.length === 0 || wanted.includes(c));
mkdirSync(out, { recursive: true });

for (const clip of clips) {
  const browser = await chromium.launch({
    channel: process.env.AEX_E2E_CHANNEL ?? "msedge",
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${join(clipDir, `${clip}.y4m`)}`,
    ],
  });
  const page = await browser.newPage();
  await page.goto(APP);
  await page.getByTestId("camera-toggle").click();
  await page.waitForFunction(() => (window.__AEX_TRACKING__?.frames.length ?? 0) > 5, null, {
    timeout: 60_000,
  });
  // One full loop of the clip, so every pose in it appears in the fixture.
  const ms = Math.ceil(durationOf(clip) * 1000) + 300;
  await page.evaluate(() => window.__AEX_RECORDER__?.start());
  await page.waitForTimeout(ms);
  const frames = await page.evaluate(() => window.__AEX_RECORDER__?.stop() ?? []);
  await browser.close();
  const target = join(out, `${clip}.json.gz`);
  writeFileSync(target, gzipSync(JSON.stringify(frames.map(compact))));
  console.log(`wrote    ${target} (${frames.length} frames over ${ms} ms)`);
}
