// `pnpm --filter @hai/desktop run dist`: builds the installer (release/HAI-Setup-<version>.exe), signed. With --unsigned (or
// HAI_ALLOW_UNSIGNED=1) it builds an unsigned one, for a test build or for friends. HAI_VERSION sets the version (the
// release workflow passes the tag's), HAI_PACKAGE_NAME the name the install folder and data folder take (HAI; the installer
// test uses another so it cannot touch a real install), and extra arguments after `--` go to electron-builder as they are.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { stageApp } from "./bundle.ts";
import { SigningError, signingFor } from "./signing.ts";

const desktopRoot = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const passthrough = args.includes("--") ? args.slice(args.indexOf("--") + 1) : [];

let signing: ReturnType<typeof signingFor>;
try {
  signing = signingFor(process.env, { allowUnsigned: args.includes("--unsigned") });
} catch (error) {
  if (error instanceof SigningError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
if (signing.mode === "unsigned") {
  console.warn(
    "Building an UNSIGNED installer. Windows will warn about it, and Smart App Control can block it outright. Do not publish it.",
  );
}

await stageApp(desktopRoot);

const version = process.env.HAI_VERSION?.trim();
const packageName = process.env.HAI_PACKAGE_NAME?.trim() || "HAI";
const builderArgs = [
  join(desktopRoot, "node_modules", "electron-builder", "cli.js"),
  "--win",
  "nsis",
  "--publish",
  "never",
  // The workspace package is called @hai/desktop, and the installer names its folder (and the app's data folder) after the
  // package name, which would give "@haidesktop". The app is called HAI.
  `-c.extraMetadata.name=${packageName}`,
  // The app's own data folder is named after productName in the packaged package.json.
  `-c.extraMetadata.productName=${packageName}`,
  ...(version ? [`-c.extraMetadata.version=${version}`] : []),
  ...signing.args,
  ...passthrough,
];

/**
 * While it builds the installer, electron-builder runs a stub it has just written. Windows (antivirus scanning the new file)
 * now and then refuses with `spawn UNKNOWN`, and the same build works a moment later. That one error is tried again, up to
 * three times; any other failure is final.
 */
let status = 1;
for (let attempt = 1; attempt <= 3; attempt++) {
  const builder = spawnSync(process.execPath, builderArgs, {
    cwd: desktopRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  process.stdout.write(builder.stdout);
  process.stderr.write(builder.stderr);
  status = builder.status ?? 1;
  if (status === 0 || !`${builder.stdout}${builder.stderr}`.includes("spawn UNKNOWN") || attempt === 3) break;
  const waitSeconds = 20 * attempt;
  console.warn(
    `Windows would not run a file the build had just made (spawn UNKNOWN). Waiting ${waitSeconds} s and trying again (${attempt}/2).`,
  );
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitSeconds * 1000);
}
process.exit(status);
