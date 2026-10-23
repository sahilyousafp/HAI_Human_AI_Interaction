// Builds the two installers `update-test.ts` updates between: 0.0.1 and 0.0.2, unsigned, under a different name ("HAI Update Test")
// with their release feed pointed at the local port the test serves. A separate script, run before the test (see the
// `test:update` command), because the test installs, kills and uninstalls programs and Windows' antivirus can then refuse to
// run what the same process builds.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ID, FEED_PORT, NAME } from "./update-test-config.ts";

const desktopRoot = join(import.meta.dirname, "..");
const outRoot = join(desktopRoot, "release-updatetest");
const configFile = join(desktopRoot, "electron-builder.updatetest.yml");

// electron-builder.yml with its release feed pointed at the local server. It sits beside the real one, because electron-builder
// resolves the file patterns and package.json relative to the configuration file it is given.
function writeConfig(): void {
  const real = readFileSync(join(desktopRoot, "electron-builder.yml"), "utf8");
  const at = real.indexOf("publish:");
  if (at < 0) throw new Error("electron-builder.yml has no publish block to replace.");
  writeFileSync(
    configFile,
    `${real.slice(0, at)}publish:\n  provider: generic\n  url: http://127.0.0.1:${FEED_PORT}\n`,
  );
}

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });
writeConfig();
try {
  for (const version of ["0.0.1", "0.0.2"]) {
    const built = spawnSync(
      process.execPath,
      [
        join(desktopRoot, "scripts", "dist.ts"),
        "--unsigned",
        "--",
        `-c.productName=${NAME}`,
        `-c.appId=${APP_ID}`,
        `-c.nsis.shortcutName=${NAME}`,
        `-c.directories.output=${join(outRoot, `v${version}`)}`,
        "--config",
        configFile,
      ],
      {
        cwd: desktopRoot,
        stdio: "inherit",
        env: { ...process.env, HAI_VERSION: version, HAI_PACKAGE_NAME: NAME },
      },
    );
    if (built.status !== 0) {
      console.error(`The build of ${version} failed.`);
      process.exit(built.status ?? 1);
    }
  }
} finally {
  rmSync(configFile, { force: true });
}
console.log("\nBuilt 0.0.1 and 0.0.2.");
