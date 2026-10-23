// `pnpm --filter @hai/desktop run test:installer` (Windows): builds an unsigned installer under a different name ("HAI
// Install Test", its own app id and data folder, so it can never touch a real HAI install), installs it silently,
// checks what the installer promises, installs over it, uninstalls, and cleans up. It changes this computer for a
// minute (a program under your local application folder, a Start menu and a desktop shortcut, an uninstall entry in the
// current user's registry) and puts all of it back.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NAME = "HAI Install Test";
const APP_ID = "io.github.sahilyousafp.hai.installtest";
const desktopRoot = join(import.meta.dirname, "..");
const outDir = join(desktopRoot, "release-installtest");

if (process.platform !== "win32") {
  console.error("The installer test runs on Windows only.");
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
const programs = join(roaming, "Microsoft", "Windows", "Start Menu", "Programs");
const installDir = join(local, "Programs", NAME);
const startMenu = join(programs, `${NAME}.lnk`);
// The Desktop folder is often redirected (to OneDrive, for one), so Windows is asked where it is.
const desktopFolder =
  spawnSync("powershell.exe", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"], {
    encoding: "utf8",
  }).stdout.trim() || join(homedir(), "Desktop");
const desktop = join(desktopFolder, `${NAME}.lnk`);
const dataDir = join(roaming, NAME);
/** The uninstall entries in this user's registry for the test app (its key is a GUID made from the app id). */
function uninstallEntries(): string[] {
  const listed = spawnSync(
    "reg",
    ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "/s", "/f", NAME, "/d"],
    { encoding: "utf8" },
  ).stdout;
  return listed.split(/\r?\n/).filter((line) => line.startsWith("HKEY_CURRENT_USER\\"));
}
const hasRegistryEntry = () => uninstallEntries().length > 0;
const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean) as string[];

// Never run over something that is already there: it is not ours to remove.
for (const path of [installDir, startMenu, dataDir]) {
  if (existsSync(path)) {
    console.error(
      `${path} already exists. Remove it (it belongs to an earlier run of this test) and try again.`,
    );
    process.exit(1);
  }
}

// A process that is not elevated cannot start a program that asks for administrator rights (Windows refuses with an
// error), so an installer that starts from here needs none.
const elevated = spawnSync("net", ["session"], { stdio: "ignore" }).status === 0;
console.log(
  elevated
    ? "note: this shell is elevated, so 'needs no administrator' is not proven by this run"
    : "this shell is not elevated",
);

rmSync(outDir, { recursive: true, force: true });
const build = spawnSync(
  process.execPath,
  [
    join(desktopRoot, "scripts", "dist.ts"),
    "--unsigned",
    "--",
    `-c.productName=${NAME}`,
    `-c.appId=${APP_ID}`,
    `-c.nsis.shortcutName=${NAME}`,
    `-c.directories.output=${outDir}`,
  ],
  {
    cwd: desktopRoot,
    stdio: "inherit",
    env: { ...process.env, HAI_PACKAGE_NAME: NAME, HAI_VERSION: "0.0.0" },
  },
);
if (build.status !== 0) process.exit(build.status ?? 1);
const installer = join(outDir, "HAI-Setup-0.0.0.exe");
check(existsSync(installer), "the installer was built");

async function cleanUp() {
  const uninstaller = join(installDir, `Uninstall ${NAME}.exe`);
  if (existsSync(uninstaller)) {
    spawnSync(uninstaller, ["/currentuser", "/S"], { stdio: "ignore" });
    await waitFor("the uninstaller to finish", () => !existsSync(installDir), 30_000);
  }
  for (const path of [installDir, startMenu, desktop, dataDir, outDir]) {
    rmSync(path, { recursive: true, force: true });
  }
  for (const key of uninstallEntries()) spawnSync("reg", ["delete", key, "/f"], { stdio: "ignore" });
}

try {
  // Install, silently, as the current user.
  const first = spawnSync(installer, ["/S"], { stdio: "ignore" });
  check(
    first.status === 0 && !first.error,
    `the installer ran without asking for administrator rights (exit ${first.status}${first.error ? `, ${first.error.message}` : ""})`,
  );
  await waitFor("the install to finish", () => existsSync(join(installDir, `${NAME}.exe`)));
  check(
    existsSync(join(installDir, `${NAME}.exe`)),
    `the program is under the local application folder (${installDir})`,
  );
  check(
    !programFiles.some((root) => existsSync(join(root, NAME))),
    "nothing was written under Program Files",
  );
  check(existsSync(join(installDir, "resources", "app", "dist", "main.js")), "the app's files are in place");
  await waitFor("the shortcut", () => existsSync(startMenu), 10_000);
  check(existsSync(startMenu), "a Start menu entry was created");
  check(existsSync(desktop), "a desktop shortcut was created");
  check(hasRegistryEntry(), "an uninstall entry exists for this user");
  const running = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${NAME}.exe`, "/NH"], {
    encoding: "utf8",
  }).stdout;
  check(!running.includes(`${NAME}.exe`), "a silent install does not start the app");

  // The user's work: a project and settings in the data folder.
  mkdirSync(join(dataDir, ".hai"), { recursive: true });
  writeFileSync(join(dataDir, ".hai", "settings.json"), '{"lastProject":"kept"}');

  // A newer version installed over the old one keeps it.
  const second = spawnSync(installer, ["/S"], { stdio: "ignore" });
  check(second.status === 0, "installing over the top works");
  await sleep(3000);
  check(existsSync(join(dataDir, ".hai", "settings.json")), "installing over the top keeps the user's data");

  // Uninstall with the default choices.
  const uninstaller = join(installDir, `Uninstall ${NAME}.exe`);
  check(existsSync(uninstaller), "an uninstaller was installed");
  spawnSync(uninstaller, ["/currentuser", "/S"], { stdio: "ignore" });
  // The uninstaller copies itself aside and returns at once; wait for the folder to go.
  check(
    await waitFor("the program folder to be removed", () => !existsSync(installDir)),
    "uninstalling removes the program",
  );
  check(
    await waitFor("the Start menu entry to go", () => !existsSync(startMenu), 15_000),
    "uninstalling removes the Start menu entry",
  );
  check(
    await waitFor("the desktop shortcut to go", () => !existsSync(desktop), 15_000),
    "uninstalling removes the desktop shortcut",
  );
  check(
    await waitFor("the uninstall entry to go", () => !hasRegistryEntry(), 15_000),
    "uninstalling removes the uninstall entry",
  );
  check(
    existsSync(join(dataDir, ".hai", "settings.json")) &&
      readFileSync(join(dataDir, ".hai", "settings.json"), "utf8").includes("kept"),
    "uninstalling with the default choices keeps the user's projects and settings",
  );
} finally {
  await cleanUp();
}

check(
  !existsSync(installDir) && !existsSync(startMenu) && !existsSync(dataDir) && !hasRegistryEntry(),
  "this computer is as it was",
);
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nThe installer does what it promises.");
