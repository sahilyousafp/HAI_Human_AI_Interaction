import { expect, test } from "@playwright/test";
import { attachPreview, overlayColorCounts } from "../overlay.ts";
import { frames, startCamera } from "../tracking.ts";

// Plays test-assets/clips/head-turn.mp4 as the camera: the maintainer turns right, then left, then looks up.
// The fake camera loops the clip, so one full loop (about 6 s) plus margin covers every pose.
// Signs were checked on still frames: turning right gives negative yaw, left positive, looking up positive pitch.
test("head turn: yaw goes beyond 15 degrees on both sides and pitch rises when looking up", async ({
  page,
}) => {
  await page.goto("/");
  await startCamera(page);
  // Watch until every pose has been seen, however slowly the machine processes frames. On CPU-only runners face
  // tracking runs on alternate frames and the full look-up has no detectable face, so few frames carry a pose.
  const startSeq = (await frames(page)).at(-1)?.seq ?? -1;
  const extremes = async () => {
    const poses = (await frames(page)).filter((f) => f.seq > startSeq && f.yaw !== null && f.pitch !== null);
    const yaws = poses.map((f) => f.yaw as number);
    const pitches = poses.map((f) => f.pitch as number);
    return {
      left: Math.max(-Infinity, ...yaws) > 15,
      right: Math.min(Infinity, ...yaws) < -15,
      up: Math.max(-Infinity, ...pitches) > 20,
    };
  };
  await expect
    .poll(extremes, { timeout: 90_000, intervals: [500] })
    .toEqual({ left: true, right: true, up: true });
});

test("debug overlay draws the head axes", async ({ page }, testInfo) => {
  await page.goto("/");
  await startCamera(page);
  // The clip includes a full look-up where no face is found and no axes are drawn, so wait (up to one loop)
  // for a frame with a face: one line per axis in the risk (x), ok (y) and axis-z colours.
  const axesDrawn = async () => {
    const counts = await overlayColorCounts(page, ["--risk", "--ok", "--axis-z"]);
    return Math.min(counts["--risk"] ?? 0, counts["--ok"] ?? 0, counts["--axis-z"] ?? 0);
  };
  await expect.poll(axesDrawn, { timeout: 15_000, intervals: [250] }).toBeGreaterThan(30);
  await attachPreview(page, testInfo, "head-turn-overlay");
});
