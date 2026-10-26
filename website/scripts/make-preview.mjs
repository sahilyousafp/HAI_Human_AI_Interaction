// Make a stage card's looping preview: a short, silent 640x360 clip that plays like a GIF at a fraction of
// a GIF's size, plus a still of its first frame for reduced motion and slow connections.
//
//   From the key part of a recording:  node scripts/make-preview.mjs <slug> <video.mp4> <start-s> <length-s>
//   As a slideshow of still images:   node scripts/make-preview.mjs <slug> <image> <image> [image...]
//
// Output: public/media/<slug>-preview.mp4 and <slug>-preview.webp (gitignored, like the full clips).

import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const W = 640;
const H = 360;
const FPS = 24;
// Each still holds this long, then cross-fades into the next.
const HOLD = 2.6;
const FADE = 0.6;

const [slug, ...rest] = process.argv.slice(2);
if (!slug || rest.length < 2) {
  console.error(
    "usage: make-preview.mjs <slug> <video> <start> <length> | <slug> <image> <image> [image...]",
  );
  process.exit(1);
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "media");
mkdirSync(out, { recursive: true });
const mp4 = join(out, `${slug}-preview.mp4`);
const run = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
const encode = [
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "27",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
];
// Fill the 16:9 card, trimming whatever overhangs. Stills keep their top edge, where the headline is.
const cover = (y) =>
  `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})/2:${y},setsar=1`;

const isVideo = [".mp4", ".mov", ".webm", ".mkv"].includes(extname(rest[0]).toLowerCase());
if (isVideo) {
  const [src, start, length] = rest;
  run(["-ss", start, "-t", length, "-i", src, "-vf", `${cover(`(ih-${H})/2`)},fps=${FPS}`, ...encode, mp4]);
} else {
  const inputs = rest.flatMap((img) => ["-loop", "1", "-t", String(HOLD + FADE), "-i", img]);
  const prep = rest.map((_, i) => `[${i}]${cover(0)},fps=${FPS},format=yuv420p[s${i}]`);
  // Chain the cross-fades; the loop then cuts from the last still straight back to the first.
  const fades = [];
  let prev = "s0";
  for (let i = 1; i < rest.length; i++) {
    fades.push(
      `[${prev}][s${i}]xfade=transition=fade:duration=${FADE}:offset=${(HOLD * i).toFixed(2)}[x${i}]`,
    );
    prev = `x${i}`;
  }
  const total = HOLD * rest.length;
  const graph = [...prep, ...fades, `[${prev}]trim=0:${total},setpts=PTS-STARTPTS[v]`].join(";");
  run([...inputs, "-filter_complex", graph, "-map", "[v]", ...encode, mp4]);
}

run(["-i", mp4, "-frames:v", "1", "-quality", "82", join(out, `${slug}-preview.webp`)]);
console.log(
  `${slug}: preview ${(statSync(mp4).size / 1e3).toFixed(0)} kB -> public/media/${slug}-preview.mp4`,
);
