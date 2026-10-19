import { expect, test } from "@playwright/test";
import { attachPreview, overlayColorCounts } from "../overlay.ts";
import { framesDuring, startCamera } from "../tracking.ts";

// Plays test-assets/clips/head-turn.mp4 as the camera: the maintainer turns right, then left, then looks up.
// The fake camera loops the clip, so one full loop (about 6 s) plus margin covers every pose.
// Signs were checked on still frames: turning right gives negative yaw, left positive, looking up positive pitch.
test("head turn: yaw goes beyond 15 degrees on both sides and pitch rises when looking up", async ({
  page,
}) => {
  await page.goto("/");
  await startCamera(page);
  // A full loop of the clip at any frame rate: at least 9 s and 40 frames.
  const list = await framesDuring(page, 9000, 40);
  const yaws = list.map((f) => f.yaw).filter((y): y is number => y !== null);
  const pitches = list.map((f) => f.pitch).filter((p): p is number => p !== null);
  expect(yaws.length).toBeGreaterThan(20);
  expect(Math.max(...yaws)).toBeGreaterThan(15);
  expect(Math.min(...yaws)).toBeLessThan(-15);
  expect(Math.max(...pitches)).toBeGreaterThan(20);
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
