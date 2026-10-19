// Test clips for Chromium's fake camera.
// The repository stores small H.264 MP4s; Chromium needs uncompressed .y4m (about 14 MB per second at 640x480),
// so .y4m files are generated on demand into .aex/clips (git-ignored) and cached.
//
//   node scripts/convert-clips.mjs import <folder-with-recordings>   normalise recordings into test-assets/clips/*.mp4
//   node scripts/convert-clips.mjs build [--out <folder>]           (re)generate .y4m files for every MP4 present
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

const CLIPS = ["no-hands", "one-hand-pinch", "two-hands", "head-turn", "open-palm"];
const MAX_SECONDS = 8;
const root = join(import.meta.dirname, "..");
const clipDir = join(root, "test-assets", "clips");
const VIDEO_FILTER = "scale=640:480:force_original_aspect_ratio=increase,crop=640:480,fps=30";

const ffmpeg = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function importRecordings(source) {
  if (!source || !existsSync(source)) {
    console.error("Usage: node scripts/convert-clips.mjs import <folder-with-recordings>");
    process.exit(2);
  }
  const files = readdirSync(source).filter((f) => statSync(join(source, f)).isFile());
  let missing = 0;
  for (const clip of CLIPS) {
    const input = files.find((f) => basename(f, extname(f)).toLowerCase() === clip);
    if (!input) {
      console.error(`missing  ${clip} (expected a file named ${clip}.<ext> in ${source})`);
      missing += 1;
      continue;
    }
    const target = join(clipDir, `${clip}.mp4`);
    ffmpeg([
      "-i",
      join(source, input),
      "-t",
      String(MAX_SECONDS),
      "-vf",
      VIDEO_FILTER,
      "-c:v",
      "libx264",
      "-crf",
      "23",
      "-preset",
      "slow",
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-movflags",
      "+faststart",
      target,
    ]);
    console.log(`wrote    ${target} (${(statSync(target).size / 1e3).toFixed(0)} KB)`);
  }
  return missing;
}

/** Generates .y4m files for the MP4s present; returns the clip names available. */
export function buildClips(out = join(root, ".aex", "clips")) {
  if (!existsSync(clipDir)) return [];
  const sources = readdirSync(clipDir).filter((f) => f.endsWith(".mp4"));
  if (sources.length === 0) return [];
  mkdirSync(out, { recursive: true });
  const built = [];
  for (const file of sources) {
    const clip = basename(file, ".mp4");
    const src = join(clipDir, file);
    const target = join(out, `${clip}.y4m`);
    if (!existsSync(target) || statSync(target).mtimeMs < statSync(src).mtimeMs) {
      ffmpeg(["-i", src, "-vf", VIDEO_FILTER, "-pix_fmt", "yuv420p", "-an", target]);
      console.log(`built    ${target}`);
    }
    built.push(clip);
  }
  return built;
}

if (import.meta.main) {
  const [command, arg] = process.argv.slice(2);
  if (command === "import") process.exit(importRecordings(arg) > 0 ? 1 : 0);
  else if (command === "build") console.log(`clips: ${buildClips(flag("--out")).join(", ") || "none"}`);
  else {
    console.error("Usage: node scripts/convert-clips.mjs import <folder> | build [--out <folder>]");
    process.exit(2);
  }
}
