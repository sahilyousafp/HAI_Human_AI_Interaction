// `pnpm --filter @hai/desktop run test:update` (Windows): one real update, with the real electron-updater, from an installed
// version to the next. It builds two unsigned installers (0.0.1 and 0.0.2) under a different name ("HAI Update Test", its own
// app id and data folder, so it can never touch a real HAI install), installs 0.0.1, serves 0.0.2 as a release feed from a
// local port, drives the installed app through check, download and restart, and checks that the program on disk is now 0.0.2.
// Then it removes everything. It changes this computer for a few minutes (the same as the installer test, and the app runs).
import { spawnSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { _electron } from "@playwright/test";
import { FEED_PORT, NAME } from "./update-test-config.ts";

const PORT = FEED_PORT;
const desktopRoot = join(import.meta.dirname, "..");
const outRoot = join(desktopRoot, "release-updatetest");
const feedDir = join(outRoot, "feed");

if (process.platform !== "win32") {
  console.error("The update test runs on Windows only.");
  process.exit(1);
}

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(what: string, test: () => boolean, ms = 60_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(500);
  }
  console.log(`     (gave up waiting for ${what})`);
  return false;
}

const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
const installDir = join(local, "Programs", NAME);
const exe = join(installDir, `${NAME}.exe`);
const dataDir = join(roaming, NAME);
const installedVersion = (): string | null => {
  try {
    return JSON.parse(readFileSync(join(installDir, "resources", "app", "package.json"), "utf8"))
      .version as string;
  } catch {
    return null;
  }
};

for (const path of [installDir, dataDir]) {
  if (existsSync(path)) {
    console.error(
      `${path} already exists. Remove it (it belongs to an earlier run of this test) and try again.`,
    );
    process.exit(1);
  }
}

const builtInstaller = (version: string): string => join(outRoot, `v${version}`, `HAI-Setup-${version}.exe`);

function killApp(): void {
  spawnSync("taskkill", ["/IM", `${NAME}.exe`, "/T", "/F"], { stdio: "ignore" });
}

let feed: ReturnType<typeof createServer> | null = null;
const requested: string[] = [];

async function cleanUp() {
  killApp();
  await sleep(1500);
  const uninstaller = join(installDir, `Uninstall ${NAME}.exe`);
  if (existsSync(uninstaller)) {
    spawnSync(uninstaller, ["/currentuser", "/S"], { stdio: "ignore" });
    await waitFor("the uninstaller to finish", () => !existsSync(installDir), 30_000);
    await sleep(3000);
  }
  for (const path of [installDir, dataDir, outRoot]) {
    rmSync(path, { recursive: true, force: true });
  }
  for (const base of [join(roaming, "Microsoft", "Windows", "Start Menu", "Programs"), local]) {
    rmSync(join(base, `${NAME}.lnk`), { force: true });
  }
  const listed = spawnSync(
    "reg",
    ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "/s", "/f", NAME, "/d"],
    { encoding: "utf8" },
  ).stdout;
  for (const key of listed.split(/\r?\n/).filter((l) => l.startsWith("HKEY_CURRENT_USER\\"))) {
    spawnSync("reg", ["delete", key, "/f"], { stdio: "ignore" });
  }
  feed?.close();
}

let app: Awaited<ReturnType<typeof _electron.launch>> | null = null;
try {
  // Built by scripts/update-fixtures.ts, which `pnpm run test:update` runs first.
  const first = builtInstaller("0.0.1");
  const second = builtInstaller("0.0.2");
  if (!existsSync(first) || !existsSync(second)) {
    console.error(
      "The two installers are not built. Run `pnpm --filter @hai/desktop run test:update`, which builds them first.",
    );
    process.exit(1);
  }
  check(true, "both versions were built");

  // The feed: what a release carries (the installer, its block map and latest.yml), served from this computer.
  mkdirSync(feedDir, { recursive: true });
  for (const name of ["HAI-Setup-0.0.2.exe", "HAI-Setup-0.0.2.exe.blockmap", "latest.yml"]) {
    cpSync(join(outRoot, "v0.0.2", name), join(feedDir, name));
  }
  feed = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "").split("?")[0] ?? "").replace(/^\/+/, "");
    requested.push(path);
    const file = join(feedDir, path);
    if (!path || path.includes("..") || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-length": statSync(file).size });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => feed?.listen(PORT, "127.0.0.1", resolve));

  // Install 0.0.1, as a user would.
  const install = spawnSync(first, ["/S"], { stdio: "ignore" });
  check(install.status === 0, `version 0.0.1 installed (exit ${install.status})`);
  await waitFor("the install", () => existsSync(exe));
  check(installedVersion() === "0.0.1", `the program on disk is 0.0.1 (${installedVersion()})`);

  // Start the installed app and use it through its own page.
  app = await _electron.launch({ executablePath: exe, args: [] });
  const page = await app.firstWindow();
  await page.waitForFunction(
    () => Boolean((globalThis as unknown as { haiDesktop?: unknown }).haiDesktop),
    null,
    { timeout: 60_000 },
  );
  type Updates = {
    state(): Promise<{ status: string; version?: string; current: string }>;
    check(): Promise<void>;
    download(): Promise<void>;
    restart(): Promise<boolean>;
  };
  const updates = () =>
    page.evaluate(() =>
      (globalThis as unknown as { haiDesktop: { updates: Updates } }).haiDesktop.updates.state(),
    );
  const call = (method: "check" | "download" | "restart") =>
    page.evaluate(
      (m) =>
        (
          globalThis as unknown as { haiDesktop: { updates: Record<string, () => Promise<unknown>> } }
        ).haiDesktop.updates[m]?.(),
      method,
    );

  const before = await updates();
  check(before.current === "0.0.1", `the app says it is 0.0.1 (${before.current})`);
  check(before.status !== "unavailable", `updating is available in an installed app (${before.status})`);

  // The start-up check may already have found it; either way, ask.
  await call("check");
  await waitFor("the new version to be found", () => true, 100);
  let found = await updates();
  for (let i = 0; i < 60 && found.status !== "available"; i++) {
    await sleep(500);
    found = await updates();
  }
  check(
    found.status === "available" && found.version === "0.0.2",
    `the check finds 0.0.2 (${found.status} ${found.version ?? ""})`,
  );
  check(requested.includes("latest.yml"), "it read the release feed (latest.yml)");
  check(!requested.some((r) => r.endsWith(".exe")), "finding it downloaded nothing");

  await call("download");
  let ready = await updates();
  for (let i = 0; i < 240 && ready.status !== "ready"; i++) {
    await sleep(500);
    ready = await updates();
  }
  check(ready.status === "ready", `the download finished and verified (${ready.status})`);
  check(
    requested.some((r) => r.endsWith(".exe")),
    "it downloaded the installer from the feed",
  );
  check(installedVersion() === "0.0.1", "downloading changed nothing on disk");

  // Restart into it. The app quits, the installer replaces the program, and the new version starts.
  const closed = new Promise<void>((resolve) => app?.process().once("exit", () => resolve()));
  await call("restart").catch(() => {});
  await Promise.race([closed, sleep(30_000)]);
  const updated = await waitFor(
    "the program on disk to become 0.0.2",
    () => installedVersion() === "0.0.2",
    120_000,
  );
  check(updated, `the program on disk is now 0.0.2 (${installedVersion()})`);
  // The new version is started by the installer.
  const isRunning = () =>
    spawnSync("tasklist", ["/FI", `IMAGENAME eq ${NAME}.exe`, "/NH"], { encoding: "utf8" }).stdout.includes(
      `${NAME}.exe`,
    );
  check(await waitFor("the new version to start", isRunning, 60_000), "the new version started");
  check(existsSync(dataDir), "the user's data folder is still there");
} finally {
  await app?.close().catch(() => {});
  await cleanUp();
}

check(!existsSync(installDir) && !existsSync(dataDir) && !existsSync(outRoot), "this computer is as it was");
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nThe real updater moved the installed app from 0.0.1 to 0.0.2.");
