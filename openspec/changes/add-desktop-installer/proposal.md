# Proposal

## Why

HAI is built for architects, but today it starts from a git clone: install Node 24 and pnpm, run `pnpm install`, `pnpm assets` and `pnpm dev`, install Claude Code and sign in by hand. Almost none of the people it is for can do that, so nobody outside the maintainer can try it. The bridge has to run on the user's own machine (it starts their own `claude` and, later, talks to Rhino), so putting the web app on a host does not remove the install step. What is needed is one file a person downloads from the project website, double clicks, and gets a working app, with no warning screen that tells them to stop.

## What Changes

- **A desktop app wraps what exists.**
  - An Electron app starts the bridge, serves the built web app from a fixed secure origin and opens it in its own window.
  - The user needs no Node, pnpm or git: Electron carries its own Node.
  - It is the same web app, bridge and protocol; nothing about gestures, tools or the agent changes.
- **A first-run screen replaces `pnpm assets`.**
  - The small models and the runtimes ship in the installer; the large voice models (about 330 MB for Kokoro, the speech model) download on first run with a progress bar, checked against the SHA-256 in `scripts/assets.lock.json`, and resume after an interruption.
  - The app is usable for hands and camera before the voice models finish.
- **A guided Claude Code step.**
  - The app runs the existing checks (`claude --version`, `claude auth status`).
  - If Claude Code is missing, it offers to run Anthropic's own installer, after the user agrees and after showing exactly what will run.
  - If the user is not signed in, it opens a terminal running `claude` and re-checks when the user comes back.
  - HAI still never reads, stores or forwards credentials and never bundles the `claude` binary.
- **A signed installer, downloaded from the website.**
  - A per-user Windows installer (no administrator rights) built by electron-builder and signed with Azure Trusted Signing, so Windows shows a verified publisher instead of a block.
  - A landing page with the download button and the SHA-256 of the file.
  - The app updates itself from a signed update feed.
- **The installed app finds Claude Code where the official installer puts it.** A `claude` that is installed but not yet on the PATH of the running app (the usual case right after the guided install) is found in its default folder.

## Capabilities

### New Capabilities

- `desktop-app`: the installed app's window, the origin it serves the web app from, how the page gets the bridge session, camera permission, one running copy, and where its data lives.
- `first-run-setup`: the first-run screen: model downloads with verification and resume, and the guided Claude Code installation and sign-in.
- `desktop-distribution`: the signed per-user installer, the download page's checksum, updates, and what uninstalling keeps.

### Modified Capabilities

- `agent-session`: "Claude Code installation and login are detected" also finds `claude` in the folder the official installer uses when it is not on the PATH.

## Impact

- **apps/desktop (new)**: Electron main process, preload, first-run window, electron-builder configuration.
- **apps/bridge**: a build step that compiles it to plain JavaScript (it runs from TypeScript through `tsx` today); `config.ts` gets the desktop origin through the existing `HAI_ALLOWED_ORIGINS`; the workspace folder comes from `HAI_WORKSPACE`. No change to the protocol.
- **apps/web**: `window.__HAI_SESSION__` is injected by a Vite plugin in dev only; the desktop supplies it through the preload script. No other change expected.
- **packages/agent-core**: `detect.ts` looks in the default install folder.
- **scripts**: the asset downloader's core moves into a module that both `scripts/fetch-assets.mjs` and the desktop app use.
- **Dependencies**: `electron`, `electron-builder`, `electron-updater` as desktop-only dependencies. Electron is MIT; `pnpm licenses:check` must still pass for what ships.
- **CI**: a release workflow that builds, signs and uploads the installer and the update feed.
- **Docs**: `docs/desktop.md` (install, first run, where data lives, uninstalling), `README.md`, `docs/PLAN.md` (the Electron wrapper moves up), and the new demo `demos/13-desktop-installer.md`.
- **E2E**: a new `e2e/desktop.spec.ts` that launches the Electron app with Playwright's Electron support and Chromium's fake camera.
- **Maintainer, outside the repo**: sign up for Azure Trusted Signing and pass its identity validation (eligibility depends on country and account type), buy or pick the download domain, and set the signing secrets in CI.

## Out of scope

- macOS and Linux builds (the build is written so they can be added; they are not tested or published here).
- The Rhino plugin and its installer; it ships separately later.
- The Microsoft Store and a browser-only mode with an API key.
- Bundling, mirroring or modifying the `claude` binary, or signing the user in on their behalf.
- Silent or administrator-wide installs, and an uninstaller that deletes the user's projects.
- The overlay window over Rhino (`apps/overlay` in `docs/PLAN.md`).
- Telemetry or crash reporting that leaves the machine.
- Any change to gestures, tools, the agent or the scene.

## Demo

A 45-60 s clip, "From download to first command": on a clean Windows 11 machine, click Download on the website, double click the file, watch the first-run screen finish the models and sign in to Claude, then pinch-orbit a building and say a command to the agent. Script: `demos/13-desktop-installer.md`.
