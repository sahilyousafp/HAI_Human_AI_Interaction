// Encode a screen recording for the web: H.264 MP4 with the index up front (so it starts and seeks before it
// has downloaded), plus a poster frame in JPG and WebP. Prints the duration for the stage's frontmatter.
//
//   node scripts/encode-video.mjs <source.mp4> <slug> [poster-seconds]
//
// Output lands in public/media/, which is gitignored: re-run this to rebuild it.

import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [src, slug, posterAt = "3"] = process.argv.slice(2);
if (!src || !slug) {
  console.error("usage: node scripts/encode-video.mjs <source.mp4> <slug> [poster-seconds]");
  process.exit(1);
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "media");
mkdirSync(out, { recursive: true });
const mp4 = join(out, `${slug}.mp4`);

const run = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });

// CRF 26 keeps the UI text in the recordings sharp at full width; the clips are mostly static screens.
run([
  "-i",
  src,
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "26",
  "-pix_fmt",
  "yuv420p",
  "-profile:v",
  "high",
  "-movflags",
  "+faststart",
  "-c:a",
  "aac",
  "-b:a",
  "96k",
  "-ac",
  "2",
  mp4,
]);
run(["-ss", posterAt, "-i", mp4, "-frames:v", "1", "-q:v", "3", join(out, `${slug}.jpg`)]);
run([
  "-ss",
  posterAt,
  "-i",
  mp4,
  "-frames:v",
  "1",
  "-vf",
  "scale=1280:-2",
  "-quality",
  "80",
  join(out, `${slug}.webp`),
]);

const duration = execFileSync("ffprobe", [
  "-v",
  "error",
  "-show_entries",
  "format=duration",
  "-of",
  "default=nw=1:nk=1",
  mp4,
])
  .toString()
  .trim();
const mb = (statSync(mp4).size / 1e6).toFixed(1);
console.log(`${slug}: ${Number(duration).toFixed(1)} s, ${mb} MB -> public/media/${slug}.mp4`);
