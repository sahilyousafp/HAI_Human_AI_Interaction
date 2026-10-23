# Design

## Context

See proposal.md - Why. Where the code stands:

- The bridge (`apps/bridge`) runs from TypeScript through `tsx` (`pnpm start`), finds its workspace by walking up to `pnpm-workspace.yaml`, writes `.hai/session.json` (port, token, pid) and listens on a fixed default port. Its `@hai/*` packages are workspace links, and `SAMPLE_SCENE` is found with `import.meta.dirname`, so neither works unchanged outside the repository.
- The web app gets `window.__HAI_SESSION__` from a Vite plugin that only runs in dev (`vite-plugin-hai-session.ts`, `apply: "serve"`). A built page has no session.
- The page loads models and runtimes from absolute paths: `/models/...` (`env.localModelPath = "/models/"`, `allowRemoteModels = false`), `/ort/`, `/vad/`, `/mediapipe/`. About 390 MB of models, 40 MB of ONNX runtime and 39 MB of MediaPipe files live in `apps/web/public/`, are git-ignored, and are placed by `scripts/fetch-assets.mjs` from `scripts/assets.lock.json` (pinned URL and SHA-256 per file). Kokoro is about 325 MB of that.
- The bridge allows the origins in `HAI_ALLOWED_ORIGINS` (default the dev server), holds the token, and the MCP endpoint has its own per-agent token. The page's settings are kept in the browser, so the page's origin must not change.
- Claude Code is found with `where claude` on the PATH (`packages/agent-core/src/claude/detect.ts`), then checked with `claude --version` and `claude auth status --json`. The default project lives in `<workspace>/.hai/projects/sample`, so one folder holds all of HAI's own state.
- E2E tests use Chromium's fake camera with recorded .y4m clips and a fake `claude` (`apps/bridge/test/fake-claude.mjs`).

## Goals / Non-Goals

**Goals:**
- The installed app behaves exactly like `pnpm dev` for everything the user sees after first run: same web app, same bridge, same protocol, same privacy rules.
- Every first-run and update path is testable without a human, using the fake camera, a fake `claude`, and a local file server in place of the internet.
- The release is built and signed by CI from a tag, so the maintainer's weekly hours go to features, not to packaging.

**Non-Goals:**
- A second code path in the web app for "desktop mode". The page differs only in who supplies the session and where model files come from.
- Replacing the browser-based development flow; `pnpm dev` stays.

## Decisions

**1. Electron.**
- The bridge is Node and TypeScript and the page needs Chromium features it already relies on (WebGPU for Kokoro, workers, `getUserMedia`). Electron carries both, so the installed app runs the same engine as the one tested in Playwright.
- Rejected: Tauri (needs a Rust toolchain and a Node sidecar for the bridge anyway, and WebView2 versions vary per machine); a packaged bridge plus the user's own browser (needs a terminal-free launcher, a trusted origin and a second installer story; the origin and permission prompts are not under our control); a web page on Catalyst talking to a local bridge (still needs the same installer, and mixed-content rules differ per browser).

**2. The page is served from the privileged scheme `hai://app`, not from a loopback port.**
- A scheme registered as standard, secure and fetch-capable gives a fixed origin (settings in the page survive restarts and updates), a secure context for the camera, and lets the handler set headers on every response (cross-origin isolation if the ONNX runtime wants threads, `application/wasm` for streaming compile).
- The bridge gets `HAI_ALLOWED_ORIGINS=hai://app`, nothing else.
- Rejected: a random loopback port (the origin changes each launch and the page's stored settings are lost); a fixed loopback port (collides with other software, and any local process can load the page from it); `file://` (opaque origin, no secure context for workers).
- The handler resolves `/models/*` from the user's data folder first and the install folder second, so downloaded models appear at the same URLs the page already uses.
- Proven (tasks 1.2 and 1.3, 2026-10-23, Electron 44.9.3): with a plain handler that sets only `content-type` and `content-length`, the page loaded from `hai://app` has `isSecureContext` true; the camera started from Chromium's fake camera fed the recorded `one-hand-pinch` clip and the MediaPipe worker found the right hand in 13 of 14 frames; and the Moonshine and Kokoro round trip (`window.__HAI_SPEECH__.roundTrip`) loaded `/models/` and `/ort/` over the scheme on WebGPU and heard "Architect is working on the staircor.", the same words the existing speech test expects. So the earlier risk with the ONNX and MediaPipe loaders does not materialise.
- No COOP/COEP headers are set: the dev server sets none either, so the ONNX runtime runs as it does in dev (`crossOriginIsolated` is false). Adding them would make the page differ from the one tested in dev for no gain today.
- The handler adds a Content-Security-Policy in task 2.4 (Electron warns about its absence in unpackaged runs); it must allow `ws://127.0.0.1:*`, `blob:` workers and `wasm-unsafe-eval`, and is checked against the same run.

**3. The session reaches the page through the preload script.**
- The main process starts the bridge, learns its port and token, and the preload exposes `window.__HAI_SESSION__` in the page's world before page code runs (`contextBridge.exposeInMainWorld`, value read by a synchronous IPC call). Nothing goes through a URL, a command line, an extra file the page fetches, or a log.
- `contextIsolation` on, `nodeIntegration` off, `sandbox` on. The preload exposes exactly the session and a small first-run API (decision 6), nothing else.
- Rejected: a query string or `additionalArguments` (visible in process lists and logs); the page fetching `/session.json` (any page that can reach the origin could read it); writing it into the served `index.html` (works, but the HTML then differs from the one tested in dev).

**4. The bridge runs as a child of the main process, bundled to one file.**
- The main process starts it with `utilityProcess` and Electron's own Node, with `HAI_WORKSPACE` set to the app's data folder (`app.getPath("userData")`), `HAI_PORT=0` (the operating system picks a free port), and the allowed origin set. A crash or a `process.exit` in the bridge cannot take the window down, and quitting the app stops the child and with it the agents it spawned (Windows job semantics are verified in task 2.3, since `taskkill /T` is used today).
- The bridge learns nothing about Electron: it posts `{ port, token }` to its parent when started under one (a few lines in `main.ts`), and still writes `.hai/session.json` so the dev server and the tests work as before.
- A build step bundles `apps/bridge` and its workspace packages into one JavaScript file with esbuild, and copies `samples/` beside it; `SAMPLE_SCENE` is resolved from an environment variable the main process sets, falling back to the current relative path, so dev is unchanged.
- The Electron release is chosen so its bundled Node runs the bridge's bundle. Chosen (task 1.1, checked 2026-10-23): **Electron 44.9.3**, which bundles Node 24.22.0 (the project asks for Node 24) and Chromium 152; the bridge's TypeScript started under it with `ELECTRON_RUN_AS_NODE` and answered `GET /health`. 45.0.0 was released two days earlier; it is not used for a first public installer, and the upgrade to the next major is a routine task once it has had a few patch releases.
- Rejected: the bridge inside the main process (a bridge fault stalls the window; its signal and exit handling assume it owns the process); shipping a separate Node and running `tsx` (a second runtime to carry, slower start, the TypeScript sources shipped).

**5. The data folder is `userData`; the program is never written to.**
- `HAI_WORKSPACE` is `%APPDATA%\HAI` (Electron's `userData`). The settings, the session file, the agent conversations and the sample project all live under its `.hai/`, which is where the code already puts them, so no bridge change is needed.
- The user's own projects are wherever they choose with the existing folder picker.
- Rejected: Documents (the folder is often synced to the cloud, which would upload the session file with its token and churn on every settings write); the install folder (not writable by design, and wiped by an update).

**6. First run is a small page of the app, with a narrow API from the main process.**
- The first-run screen is a route of the web app, not a separate window with its own toolkit, so it is tested like the rest. It talks to the main process through the preload API: `setup.state()`, `setup.downloadModels()`, `setup.installClaude()`, `setup.openSignIn()`, and a progress subscription. These exist only under the desktop shell; in a browser the page does not show the screen.
- Rejected: a standalone setup window (second UI code path, no shared components); doing the downloads in the page with `fetch` (no resume across restarts, and it would put a network client in the page that the privacy test says must stay silent).

**7. Model downloads reuse the existing lock file and the same verification.**
- The core of `scripts/fetch-assets.mjs` (hash check, `.part` file, rename) moves into a module that both the script and the main process use, so there is one definition of "verified".
- `assets.lock.json` entries get a flag saying whether the file ships in the installer or is downloaded on first run: the two MediaPipe `.task` files, the MediaPipe wasm, the ONNX runtime and the voice-activity files ship; Moonshine and Kokoro are downloaded.
- Downloads go to `userData/models/<file>.part` with `Range` requests, are hashed on completion and renamed only when the hash matches. A mismatch deletes the file. One file at a time, so progress and failures are per file.
- Rejected: shipping every model in the installer (about 330 MB more for every download and every update); a content delivery network of our own (the pinned upstream URLs and hashes already exist and cost nothing).

**8. Claude Code setup runs the same checks, then offers two actions.**
- State comes from the existing `detect.ts` logic, extended to also look in the official installer's per-user folder (modified `agent-session` requirement). The window regains focus, or the user presses Re-check, and it runs again, so the app never needs a restart after an install.
- Install runs Anthropic's own Windows installer command for the user's account after the user presses a button that shows the exact command and source. The command text and address are constants in one file, checked against the official installation page at implementation time (task 1.4), and shown verbatim.
- Sign-in opens a visible terminal running `claude`; the app waits and learns the result only from `claude auth status`. The credential-boundary check covers the new code.
- Facts checked on 2026-10-23 against https://code.claude.com/docs/en/setup and https://code.claude.com/docs/en/troubleshoot-install (task 1.4), kept as constants in `apps/desktop/src/setup/claude-install.ts`:
  - the command is `irm https://claude.ai/install.ps1 | iex` in PowerShell, with no administrator rights;
  - it installs `%USERPROFILE%\.local\bin\claude.exe` and does not add that folder to the PATH, which is why detection looks there too (modified `agent-session` requirement);
  - Git for Windows is optional (without it Claude Code runs shell commands through PowerShell), so there is no prerequisite today.
- Windows prerequisites that Claude Code needs are steps in the same screen with the same consent pattern, driven by a list (empty today) so adding one is data, not a new screen. The folder constant moves into `packages/agent-core` in task 5.1 so detection and the screen share one definition.
- Rejected: bundling the `claude` binary (against the project's rules and Anthropic's distribution); an in-app sign-in form (would handle credentials); silently installing on first launch (the user must see and agree to what runs).

**9. Per-user NSIS installer, signed with Azure Trusted Signing.**
- electron-builder builds a one-click, per-user NSIS installer (no administrator prompt, installs under the user's local application folder, uninstall keeps `userData`). Signing uses Trusted Signing through electron-builder's Azure signing options, driven by repository secrets in CI; the installer, uninstaller and executable are signed with a trusted timestamp, and a CI step verifies the signature before upload.
- Why: unsigned installers can be blocked outright by Smart App Control on Windows 11, and a fresh publisher on an ordinary certificate shows a warning until reputation builds. Trusted Signing is the cheapest route with the best reputation behaviour, but eligibility depends on country and account type, so it is a precondition the maintainer confirms first (task 1.5); the fallback is an OV certificate from a certificate authority with the same electron-builder hook, accepting a warning for the first weeks. No option guarantees a warning-free first day for a new publisher.
- Rejected: an MSI (no benefit for per-user, harder updates); a ZIP (unsigned loose executables, no update path); the Microsoft Store (a different channel the user did not choose; possible later).

**10. Updates: `electron-updater` against files in the GitHub release.**
- `autoDownload` and `autoInstallOnAppQuit` are off: the app checks on start and once a day (unless the user turned that off in Settings > Setup, where the version and a Check for updates button also are), shows a pill in the top bar, downloads only when asked, and electron-updater verifies the hash from the feed and, for a signed release, the publisher's signature. The restart is held while an agent turn runs (the page tells the app when one does) and the bridge and its agents are ended first. Running from the repository the updater is absent and the page says so. A release that is not signed has only the feed's hash to rely on, which is as safe as the release page itself; the updater's signature check is off for such builds (`verifyUpdateCodeSignature=false`), and the release pipeline never produces one.
- The check is the one request the app makes of its own accord, so it is a switch, on by default, and the privacy requirement names it. The feed (`latest.yml`) and the installer are release assets next to each other.
- The download page on Catalyst Slate shows the version, size and SHA-256 and links to the release asset; the page is regenerated by the release workflow from the same hash the feed holds, so the two cannot disagree.
- Rejected: Stratus for the file (an extra moving part and unverified size limits for a 200+ MB file, with no gain over release assets); a custom updater (signature and rollback handling is the part not to write ourselves).

## Risks / Trade-offs

- [Smart App Control or SmartScreen still warns on early downloads] → Trusted Signing first; document the one-time "More info, Run anyway" path on the download page for the fallback case; measure on a clean VM (task 6.4).
- [Claude Code's Windows install steps or prerequisites change] → the command, address and prerequisite list are data in one file with a test that fails when the page is edited without it; the screen always shows the manual instructions address.
- [Custom scheme breaks a runtime that assumes http] → proven first (task 1.2), with the loopback alternative as the rejected-but-ready fallback.
- [The bridge bundle misses a dynamic import or asset] → the E2E test launches the packaged build, not only the dev build, and the bundle step fails on unresolved files.
- [Installer size (200 MB or more) slows every update] → differential updates from electron-builder's block map; models are never part of updates.
- [A second Electron to patch] → the release workflow runs on a schedule to rebuild against the latest patch of the chosen major.
- [The packaged app is harder to debug than `pnpm dev`] → logs go to `userData/logs` (no tokens, no frames), and `docs/desktop.md` says where to find them.

## Migration Plan

- Nothing to migrate: this is a new way to run the same code. The repository workflow (`pnpm dev`, `pnpm assets`) is unchanged and remains how contributors run HAI.
- Roll out in three steps: an unsigned internal build proves the shell, first-run and update flow on a clean VM; the signed build is published with the download page; the page is linked from the README and the LinkedIn clip.
- Rollback: a bad release is withdrawn by unpublishing the release asset and `latest.yml`; installed copies keep working, and the next good version updates them.

## Open Questions

- Where the project's domain and download page live (Catalyst Slate on a custom domain, or the default Catalyst address first). Does not change the app or the specs.
- Whether to also publish the installer to winget later, for people who prefer it.
