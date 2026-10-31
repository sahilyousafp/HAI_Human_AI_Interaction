// Puts the Try now app (the HAI viewer with its own scene in the page) at /try/ of the site.
// Slate builds only this folder, so the app is built here, on the machine that deploys, and copied into public/try
// (git-ignored, like public/media). Usage: npm run build:try   (then npm run build, or catalyst deploy slate)
import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const repo = join(here, "..", "..");
const built = join(repo, "apps", "web", "dist-try");
const target = join(here, "..", "public", "try");

// The app is a pnpm workspace package: build it with the workspace's own pnpm, as CI does.
execSync("pnpm --filter @hai/web build:try", { cwd: repo, stdio: "inherit" });
if (!existsSync(join(built, "index.html"))) throw new Error(`The Try now build is not at ${built}.`);
rmSync(target, { recursive: true, force: true });
cpSync(built, target, { recursive: true });
console.log(`Try now copied to ${target}`);
