// Checks the unpacked build in release/win-unpacked: it must stay within its size budget and must not carry the
// voice models, which are downloaded on first run. Prints the biggest folders so a jump in size is easy to trace.
// Usage: node scripts/check-package.ts [folder]   (default: release/win-unpacked/resources/app)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root =
  process.argv[2] ?? join(import.meta.dirname, "..", "release", "win-unpacked", "resources", "app");

/** The app's own files (the web app with its runtimes and tracking models, the bridge, the main process). */
export const BUDGET_MB = 160;
/** The voice models are downloaded after install and must not be in the package (the small voice-activity model in vad/ ships). */
const DOWNLOADED_MODELS: string[] = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "..", "..", "scripts", "assets.lock.json"), "utf8"),
  ) as {
    models: { file: string; download?: boolean }[];
  }
).models
  .filter((model) => model.download)
  .map((model) => model.file);

interface Entry {
  path: string;
  size: number;
}

function walk(dir: string, out: Entry[] = []): Entry[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) walk(path, out);
    else out.push({ path, size: statSync(path).size });
  }
  return out;
}

export function checkPackage(folder: string): {
  totalMb: number;
  problems: string[];
  top: [string, number][];
} {
  const files = walk(folder);
  const total = files.reduce((sum, f) => sum + f.size, 0);
  const problems: string[] = [];
  const totalMb = total / 1e6;
  if (totalMb > BUDGET_MB)
    problems.push(`The app is ${totalMb.toFixed(1)} MB, over its budget of ${BUDGET_MB} MB.`);
  for (const file of files) {
    const rel = relative(folder, file.path);
    if (DOWNLOADED_MODELS.some((model) => rel.replaceAll("\\", "/").endsWith(model))) {
      problems.push(`${rel} is a voice model; it is downloaded on first run, not shipped.`);
    }
  }
  const byTopFolder = new Map<string, number>();
  for (const file of files) {
    const rel = relative(folder, file.path).split(/[\\/]/);
    const key = rel.length > 2 ? `${rel[0]}/${rel[1]}` : (rel[0] ?? "");
    byTopFolder.set(key, (byTopFolder.get(key) ?? 0) + file.size);
  }
  const top = [...byTopFolder.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return { totalMb, problems, top };
}

if (import.meta.main) {
  const { totalMb, problems, top } = checkPackage(root);
  console.log(`${root}: ${totalMb.toFixed(1)} MB (budget ${BUDGET_MB} MB)`);
  for (const [folder, size] of top) console.log(`  ${(size / 1e6).toFixed(1).padStart(7)} MB  ${folder}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    process.exit(1);
  }
  console.log("ok");
}
