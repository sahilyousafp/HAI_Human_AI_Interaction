// Places pinned runtime assets in apps/web/public so the app never fetches them from a CDN at runtime.
// Models are downloaded once and verified by SHA-256; WASM files are copied from the installed npm package.
// Usage: node scripts/fetch-assets.mjs [--check]   (--check verifies without downloading)
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "apps", "web", "public");
const lock = JSON.parse(readFileSync(join(root, "scripts", "assets.lock.json"), "utf8"));
const checkOnly = process.argv.includes("--check");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

let failed = false;

for (const model of lock.models) {
  const target = join(publicDir, model.file);
  if (existsSync(target)) {
    const actual = sha256(readFileSync(target));
    if (actual === model.sha256) {
      console.log(`ok       ${model.file}`);
      continue;
    }
    console.error(`MISMATCH ${model.file}: expected ${model.sha256}, found ${actual}`);
    if (checkOnly) {
      failed = true;
      continue;
    }
    rmSync(target);
  } else if (checkOnly) {
    console.error(`MISSING  ${model.file}`);
    failed = true;
    continue;
  }

  const response = await fetch(model.url);
  if (!response.ok) {
    console.error(`FAILED   ${model.file}: HTTP ${response.status} from ${model.url}`);
    failed = true;
    continue;
  }
  const data = Buffer.from(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== model.sha256) {
    console.error(`REJECTED ${model.file}: download hash ${actual} does not match the lock file`);
    failed = true;
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(`${target}.part`, data);
  renameSync(`${target}.part`, target);
  console.log(`fetched  ${model.file} (${(data.length / 1e6).toFixed(1)} MB)`);
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
  cpSync(join(pkgDir, entry.from), target, { recursive: true });
  writeFileSync(stamp, version);
  console.log(`copied   ${entry.to} (${entry.package}@${version})`);
}

if (failed) {
  console.error("Asset check failed. Run `node scripts/fetch-assets.mjs` to repair.");
  process.exit(1);
}
