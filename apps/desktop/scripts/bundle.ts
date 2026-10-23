import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BuildOptions, build, type Plugin } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const bridgeRoot = join(here, "..", "..", "bridge");

const common: BuildOptions = {
  bundle: true,
  platform: "node",
  target: "node24",
  sourcemap: true,
  logLevel: "warning",
};

// CommonJS packages in the bundle (cross-spawn, ws) call require(); an ES module bundle has none of its own.
const requireBanner =
  'import { createRequire as __haiCreateRequire } from "node:module"; const require = __haiCreateRequire(import.meta.url);';

/** Replaces the models lock file the main process imports, for the test variant that downloads from a local server. */
const lockOverride = (lockFile: string): Plugin => ({
  name: "lock-override",
  setup(builder) {
    builder.onResolve({ filter: /assets\.lock\.json$/ }, () => ({ path: lockFile }));
  },
});

/** Swaps the modules that do the real work of the Claude Code setup and of updating for their test stand-ins. */
const fakeClaudeSetup: Plugin = {
  name: "fake-claude-setup",
  setup(builder) {
    builder.onResolve({ filter: /claude-deps\.ts$/ }, () => ({
      path: join(here, "..", "test", "claude-deps-fake.ts"),
    }));
    // The same for the updater: no network, and a feed played from files.
    builder.onResolve({ filter: /updates-deps\.ts$/ }, () => ({
      path: join(here, "..", "test", "updates-deps-fake.ts"),
    }));
  },
};

/** The Electron main process, an ES module (Electron runs those since v28). */
export async function bundleMain(
  outdir: string,
  options: { lockFile?: string; fakeClaude?: boolean } = {},
): Promise<void> {
  await build({
    ...common,
    entryPoints: [join(here, "..", "src", "main.ts")],
    outfile: join(outdir, "main.js"),
    format: "esm",
    banner: { js: requireBanner },
    external: ["electron"],
    plugins: [
      ...(options.lockFile ? [lockOverride(options.lockFile)] : []),
      ...(options.fakeClaude ? [fakeClaudeSetup] : []),
    ],
  });
}

/**
 * The bridge and the @hai/* packages it uses, as one file, plus the sample project it seeds. `ws` loads two optional
 * native speed-ups inside try/catch; leaving them out is its documented fallback.
 */
export async function bundleBridge(
  outdir: string,
  entry = join(bridgeRoot, "src", "main.ts"),
): Promise<void> {
  await build({
    ...common,
    entryPoints: [entry],
    outfile: join(outdir, "main.js"),
    format: "esm",
    banner: { js: requireBanner },
    external: ["bufferutil", "utf-8-validate"],
  });
  cpSync(join(bridgeRoot, "samples"), join(outdir, "samples"), { recursive: true });
}

/** The Electron preload script. Sandboxed preload scripts are CommonJS. */
export async function bundlePreload(outdir: string): Promise<void> {
  await build({
    ...common,
    entryPoints: [join(here, "..", "src", "preload.ts")],
    outfile: join(outdir, "preload.cjs"),
    format: "cjs",
    external: ["electron"],
  });
}

/** The model files that are downloaded on first run instead of shipping, from the lock file. */
export function downloadedModelFiles(): string[] {
  const lock = JSON.parse(
    readFileSync(join(here, "..", "..", "..", "scripts", "assets.lock.json"), "utf8"),
  ) as {
    models: { file: string; download?: boolean }[];
  };
  return lock.models.filter((model) => model.download).map((model) => model.file);
}

/**
 * The built web app as the desktop serves it. Vite copies everything in public/ (about 500 MB, the voice models
 * among it), so the downloaded models are removed again. `testHooks` builds in development mode, which keeps the
 * `window.__HAI_*__` hooks the end-to-end tests use.
 */
export function stageWeb(outdir: string, options: { testHooks?: boolean } = {}): void {
  const webRoot = join(here, "..", "..", "web");
  const env = { ...process.env, NODE_ENV: options.testHooks ? "development" : "production" };
  const step = (args: string[]) => {
    const result = spawnSync(process.execPath, args, { cwd: webRoot, env, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`${args.join(" ")} failed with exit code ${result.status}`);
  };
  // The voice models are not part of the build (they are downloaded on first run), so they are not fetched for it.
  step([join(webRoot, "..", "..", "scripts", "fetch-assets.mjs"), "--shipped-only"]);
  step([
    join(webRoot, "node_modules", "vite", "bin", "vite.js"),
    "build",
    ...(options.testHooks ? ["--mode", "development"] : []),
    "--outDir",
    outdir,
    "--emptyOutDir",
    "--logLevel",
    "warn",
  ]);
  // The folders (models/kokoro, models/moonshine-base) go entirely; downloads put them back under the user's data.
  const folders = new Set(downloadedModelFiles().map((file) => file.split("/").slice(0, 2).join("/")));
  for (const folder of folders) rmSync(join(outdir, folder), { recursive: true, force: true });
}

export interface StageOptions {
  /** Write a package.json that points Electron at dist/main.js, for a folder that is not the package itself. */
  manifest?: boolean;
  /** Keep the web app's test hooks (development build). */
  testHooks?: boolean;
  /** Run the bridge with the fake Claude Code CLI instead of the real one. */
  fakeClaude?: boolean;
  /** Download the voice models from here (`<base>/models/...`) instead of their pinned addresses; the hashes stay. */
  modelsBaseUrl?: string;
}

/** A folder Electron can start: package.json and dist/ with the main process, preload, bridge and web app. */
export async function stageApp(appDir: string, options: StageOptions = {}): Promise<void> {
  const dist = join(appDir, "dist");
  mkdirSync(dist, { recursive: true });
  if (options.manifest) {
    const manifest = {
      name: "hai-desktop",
      productName: "HAI",
      version: "0.0.0",
      description: "HAI, the Human AI Interface: the desktop app.",
      author: { name: "HAI contributors" },
      main: "dist/main.js",
      type: "module",
    };
    writeFileSync(join(appDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  let lockFile: string | undefined;
  if (options.modelsBaseUrl) {
    const lock = JSON.parse(
      readFileSync(join(here, "..", "..", "..", "scripts", "assets.lock.json"), "utf8"),
    ) as {
      models: { file: string; url: string }[];
    };
    for (const model of lock.models) model.url = `${options.modelsBaseUrl}/${model.file}`;
    lockFile = join(dist, "test-assets.lock.json");
    writeFileSync(lockFile, JSON.stringify(lock));
  }
  await bundleMain(dist, { lockFile, fakeClaude: options.fakeClaude });
  await bundlePreload(dist);
  if (options.fakeClaude) {
    const testBridge = join(here, "..", "test", "bridge-with-fake-claude.ts");
    await bundleBridge(join(dist, "bridge"), testBridge);
    // The fake provider looks for the CLI beside its own file, which in a bundle is the bundle's folder.
    copyFileSync(join(bridgeRoot, "test", "fake-claude.mjs"), join(dist, "bridge", "fake-claude.mjs"));
  } else {
    await bundleBridge(join(dist, "bridge"));
  }
  stageWeb(join(dist, "web"), options);
}

/**
 * Packages a staged folder (stageApp with `manifest`) into an unpacked build with electron-builder, the way the
 * installer's program files are made, and returns the program. For the end-to-end tests of a packaged app.
 */
export function packageApp(appDir: string, outDir: string): string {
  const desktopRoot = join(here, "..");
  const { devDependencies } = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
  const cli = join(desktopRoot, "node_modules", "electron-builder", "cli.js");
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "--dir",
      "--publish",
      "never",
      "--projectDir",
      appDir,
      "--config",
      join(desktopRoot, "electron-builder.yml"),
      `-c.directories.output=${outDir}`,
      `-c.electronVersion=${devDependencies.electron}`,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`electron-builder failed with exit code ${result.status}`);
  return join(outDir, "win-unpacked", "HAI.exe");
}
