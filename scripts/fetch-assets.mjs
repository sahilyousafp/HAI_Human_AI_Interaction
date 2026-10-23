// Places pinned runtime assets in apps/web/public so the app never fetches them from a CDN at runtime.
// Models are downloaded once and verified by SHA-256 (the work is in assets-core.ts, which the desktop app also
// uses for its first-run download); WASM and worklet files are copied from installed npm packages.
// Usage: node scripts/fetch-assets.mjs [--check] [--shipped-only]
//   --check          verifies without downloading
//   --shipped-only   leaves out the voice models the desktop app downloads on first run (a release build does not need them)
import { cpSync, existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DownloadError, downloadModel, HashMismatchError, modelState, sha256File } from "./assets-core.ts";

const root = join(import.meta.dirname, "..");
const publicDir = join(root, "apps", "web", "public");
const lock = JSON.parse(readFileSync(join(root, "scripts", "assets.lock.json"), "utf8"));
const checkOnly = process.argv.includes("--check");
const shippedOnly = process.argv.includes("--shipped-only");

let failed = false;

for (const model of lock.models) {
  if (shippedOnly && model.download) continue;
  const state = await modelState(publicDir, model);
  if (state === "ok") {
    console.log(`ok       ${model.file}`);
    continue;
  }
  if (state === "mismatch") {
    const actual = await sha256File(join(publicDir, model.file));
    console.error(`MISMATCH ${model.file}: expected ${model.sha256}, found ${actual}`);
  }
  if (checkOnly) {
    if (state === "missing") console.error(`MISSING  ${model.file}`);
    failed = true;
    continue;
  }
  try {
    await downloadModel(publicDir, model);
    const size = statSync(join(publicDir, model.file)).size;
    console.log(`fetched  ${model.file} (${(size / 1e6).toFixed(1)} MB)`);
  } catch (error) {
    if (error instanceof HashMismatchError) {
      console.error(`REJECTED ${model.file}: download hash ${error.actual} does not match the lock file`);
    } else if (error instanceof DownloadError) {
      console.error(`FAILED   ${error.message}`);
    } else {
      throw error;
    }
    failed = true;
  }
}

// Packages are installed under the web app. Some (tasks-vision) do not export package.json,
// so locate them through node_modules rather than require.resolve.
for (const entry of lock.packageFiles) {
  const pkgDir = join(root, "apps", "web", "node_modules", ...entry.package.split("/"));
  if (!existsSync(join(pkgDir, "package.json"))) {
    console.error(`MISSING  ${entry.package}: run pnpm install first`);
    failed = true;
    continue;
  }
  const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
  const target = join(publicDir, entry.to);
  const stamp = join(target, ".version");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) {
    console.log(`ok       ${entry.to} (${entry.package}@${version})`);
    continue;
  }
  if (checkOnly) {
    console.error(`STALE    ${entry.to}: expected ${entry.package}@${version}`);
    failed = true;
    continue;
  }
  rmSync(target, { recursive: true, force: true });
  // `include` (a regex on file names) copies only the files the app loads, not a whole dist folder.
  const include = entry.include ? new RegExp(entry.include) : null;
  // pnpm links a package folder into node_modules; copy the real folder, not the link.
  const source = realpathSync(join(pkgDir, entry.from));
  cpSync(source, target, {
    recursive: true,
    filter: (path) => !include || path === source || include.test(basename(path)),
  });
  writeFileSync(stamp, version);
  console.log(`copied   ${entry.to} (${entry.package}@${version})`);
}

if (failed) {
  console.error("Asset check failed. Run `node scripts/fetch-assets.mjs` to repair.");
  process.exit(1);
}
