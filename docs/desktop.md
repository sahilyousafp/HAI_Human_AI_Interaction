# Desktop app

HAI as a program you install and start, instead of a repository you run. It is the same web app, the same bridge and the same protocol, in one window, with nothing else to install first: no Node, no pnpm, no git. The desktop app lives in `apps/desktop` and is built on Electron.

This page covers using it, building it from the repository, and how it is released. For a person who just wants it, the steps are on the download page: download the installer and double click it.

## What it does

- Starts the bridge as its own process and stops it, and every agent it started, when you close the window.
- Opens one window that shows the web app from its own address, `hai://app`. The address never changes, so the page keeps your settings across restarts and updates.
- Gives the page its bridge port and session token before the page runs. The token is never in an address, a file the page can fetch or a log.
- Keeps the window inside the app. A link to the web opens in your own browser; the page cannot reach Node or your files beyond what a browser page can.
- Grants the camera and the microphone to the app's own page, and refuses every other permission (location, notifications, clipboard and the rest).
- Runs one copy at a time. Starting it again brings the running window forward and exits.
- Sends nothing anywhere, unless you switch on Open data (Settings, off by default): then the bridge asks the open-data hosts listed there for the weather, buildings and the like around the project's site, and those requests carry a place and never your work (see [open-data.md](open-data.md)). Camera frames stay in the perception worker, as in the browser, and the app itself makes no network request other than to the bridge on `127.0.0.1`.

## Run it from the repository

```sh
pnpm install
pnpm dev:desktop
```

This starts the web app's dev server on port 5174 and opens the desktop window on it, so the page reloads as you change the code. It uses its own data folder (`.hai/desktop-dev` in the repository) and its own port, so it does not touch `pnpm dev` or an installed copy of HAI. The main process, the preload script and the bridge are bundled once when the command starts: stop it with Ctrl+C and run it again to pick up changes to them.

Run from the repository, the app shows the dev server named in `HAI_DESKTOP_DEV_URL`. An installed app ignores that variable, so no setting in someone's environment can point it at another page.

## Build it

```sh
pnpm --filter @hai/desktop build
```

writes `apps/desktop/dist`: the main process, the preload script, the bridge bundle (with the sample project) and the built web app. Models that are downloaded on first run (the voice models) are left out; the two tracking models and the runtimes are in.

```sh
pnpm --filter @hai/desktop run pack
```

builds `dist` and then packages it with electron-builder into `apps/desktop/release/win-unpacked`, the folder the installer installs. `HAI.exe` there starts the app. The command finishes by checking the package: the app's own files must stay within their size budget (160 MB; about 140 MB today) and must not contain the voice models.

The command is `run pack` because `pnpm pack` is a pnpm command of its own.

## First run: Claude Code

The agent team runs on your own Claude Code, which HAI never bundles and never signs in for you. The first screen of setup (step 1 of 2) looks at it with Claude Code's own commands (`claude --version` and `claude auth status`, from which only whether you are signed in is read) and says one of four things in plain words.

| It says | Because | You can |
|---|---|---|
| **Claude Code is ready** | It is installed and an account is signed in. | Press Continue. |
| **Install Claude Code** | No `claude` was found. | Press **Install Claude Code**, press **I installed it myself** after installing by hand, or skip. |
| **Claude Code did not start** | It is installed but `claude --version` fails. | Install it again, check again, or skip. |
| **Sign in to Claude** | It runs, and no account is signed in. | Press **Open the sign-in window**, then **I have signed in**, or skip. |

What is shown before anything runs:

- **Install** shows the exact command and where it comes from before you press the button: `irm https://claude.ai/install.ps1 | iex`, Anthropic's own installer, run in PowerShell for your user account only, with no administrator rights. Nothing runs until you press **Install Claude Code**. The installer's own output is shown as it arrives and kept if it fails. The command, the address and the manual-instructions link are constants in `apps/desktop/src/setup/claude-install.ts`, taken from [Anthropic's installation page](https://code.claude.com/docs/en/setup).
- **Sign in** opens a visible terminal window running Claude Code's own `claude auth login`, which takes you to your browser. HAI starts that window and reads nothing from it: it learns that you are signed in only by asking `claude auth status` again, every few seconds while you are away and whenever you come back to the window. The screen then moves on by itself.
- Whenever an install fails, or you would rather do it yourself, the screen links to Claude Code's own instructions.
- Git for Windows is optional for Claude Code (without it, Claude Code runs shell commands through PowerShell), so nothing has to be installed first today. If a prerequisite is ever needed, add it to `CLAUDE_PREREQUISITES` in `claude-install.ts`: it is listed on this screen with whether this computer has it, and the install waits for it.

`claude` is found on the PATH, or else in `%USERPROFILE%\.local\bin`, where the installer puts it without adding it to the PATH. So a Claude Code installed while HAI is open is found without a restart, and the agent session uses the same copy.

A step you skip is remembered, so the screen does not return at every launch. **Settings > Setup** shows where Claude Code and the voice models stand and an **Open** button that brings the same screens back, each with its present state, whatever you skipped.

HAI never reads, stores or forwards credentials in any of this: `pnpm credentials:check` covers the desktop app's source.

## First run: the voice models

The installer carries everything hands and camera need: the hand and face tracking models, the viewer and the runtimes. With no network, HAI starts, tracks your hands and shows the model. Only the voice models are left out, because they are large: **Speech to text** (Moonshine) and **Spoken replies** (Kokoro), about 393 MB together. They are downloaded once, on first run.

On first launch HAI checks whether they are on this computer. If they are not, the second screen of setup (step 2 of 2) lists them with their size.

| You press | What happens |
|---|---|
| **Download** | Fetches the files one at a time and shows progress. |
| **Continue** (while downloading) | Closes the screen and lets you into the app. The download carries on behind it, and the voice controls say so (below). |
| **Stop download** | Stops it. What has arrived is kept, so the next download continues from there. |
| **Try again** (after a failure) | Starts again. A connection problem, a server error or a damaged file each says which it was. |
| **Continue without voice** | Goes on without the voice. HAI remembers this, so the screen does not return at every launch. |

How each file is made safe:

- Every file is checked against the SHA-256 pinned in `scripts/assets.lock.json` before it is used. A file that does not match is deleted and never loaded.
- A download goes to `<file>.part` and is renamed into place only when it verifies, so a half file is never where a finished one is expected.
- After an interruption (a lost connection, the app closed, a crash), the next start asks the server only for the rest of the file.
- Files that are already in place and verified are not fetched again.

Until the models are in place, the voice controls show it instead of failing: the top bar shows **Voice downloading 42%** (or **Voice not downloaded** and **Voice download failed**), the microphone button is switched off with the reason as its label, and **Settings > Voice** has a **Voice models** group with the progress and a **Download** or **Try again** button. Mochi's replies stay silent. When the models verify, all of it turns on by itself: no restart and no reload.

The models are kept in the app's data folder (see below), so updating HAI does not fetch them again.

Which files ship and which are downloaded is one flag in `scripts/assets.lock.json`: entries with `"download": true` (and their `size`) are the downloaded ones. `pnpm assets` (and `pnpm dev`) still fetch all of them into `apps/web/public`, as before.

## The installer

`pnpm --filter @hai/desktop run dist` builds `apps/desktop/release/HAI-Setup-<version>.exe`. It is a one-click installer for the current user only: no administrator prompt, the program under `%LOCALAPPDATA%\Programs\HAI`, a Start menu entry and a desktop shortcut, and the app starts when it finishes. Uninstalling removes the program, the shortcuts and the uninstall entry, and keeps your projects, settings and downloaded voice models unless you choose to remove them.

`pnpm --filter @hai/desktop run test:installer` checks all of that on this computer: it builds an unsigned copy under another name ("HAI Install Test"), installs it silently, checks the claims above, installs over the top (the data must survive), uninstalls, and removes everything it added. It refuses to run if something with that name is already there.

### Signing

An unsigned installer shows Windows' "Windows protected your PC" warning, and Windows 11 with Smart App Control on can block it completely, so a release is always signed. The build decides how from the environment (`apps/desktop/scripts/signing.ts`):

| Route | Set these |
|---|---|
| Azure Trusted Signing | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `HAI_AZURE_ENDPOINT`, `HAI_AZURE_PROFILE`, `HAI_AZURE_ACCOUNT`, `HAI_PUBLISHER_NAME` |
| A code-signing certificate | `CSC_LINK` (the .pfx), `CSC_KEY_PASSWORD`, `HAI_PUBLISHER_NAME` |

With neither set, `dist` refuses with a message that says what to do. For a test build, or for friends who can click past the warning, `pnpm --filter @hai/desktop run dist:unsigned` builds an unsigned one and says so. Everyone else should never be given that file: the release pipeline cannot produce it.

`pnpm --filter @hai/desktop run test:signing` proves the certificate route with a throwaway self-signed certificate (made in your user store and removed again): the installer and the program carry the publisher's signature with a trusted timestamp, the uninstaller is signed before it goes into the installer, a strict check refuses a root Windows does not trust, and an unsigned file is rejected. `scripts/verify-signature.ts` is the check the release uses.

Azure Trusted Signing is the cheaper route and the one that builds reputation fastest, but whether you can use it depends on your country and the kind of account you have, and it needs an identity check first. The certificate route works for anyone. Neither can promise no warning on the very first day for a brand-new publisher.

## Releasing

The step-by-step guide for the maintainer, including first-time setup and what to do when a release goes wrong, is [releasing.md](releasing.md). In short:

A release is made from a version tag, never by hand:

```sh
git tag v1.2.3
git push origin v1.2.3
```

`.github/workflows/release.yml` then runs the project's checks, builds the installer with the tag's version, and runs `apps/desktop/scripts/release-assets.ts`, the gate that fails the job, and publishes nothing, unless:

- the installer, and the program inside the build, have a valid signature with a trusted timestamp from the expected publisher;
- the update feed (`latest.yml`) names the same file with the same size and SHA-512 as the installer, so an update can be verified;
- the block map is there.

It then writes the SHA-256 next to the installer and publishes the installer, its block map, `latest.yml` and the checksum as a GitHub release. The workflow reads its signing secrets from the repository's Actions secrets and variables (the names in the table above).

To try the pipeline before there is anything to sign with, run it by hand (Actions > Release > Run workflow). That is a dry run: an unsigned build whose files are kept as a workflow artifact and never published.

### The download page

The same workflow makes `site/index.html`, a single self-contained page (no script, no outside request) with the version, the size, the SHA-256 and a download button that points at the release's file, from the files themselves, so the page cannot disagree with what it offers. A build that is not signed gets a notice about Windows' warning. The page is kept as a workflow artifact; hosting it is one more step that needs your Catalyst account: create a Slate app on the `site` folder (a plain static site, no build step) and run `catalyst deploy slate`. After it is up, `node apps/desktop/scripts/verify-download-page.ts <address>` opens it, follows the button, downloads the file and checks that its SHA-256 is the one the page shows.

## Updating

The installed app updates itself from the GitHub release it was installed from, through `electron-updater`. Nothing is installed behind your back:

- **Settings > Setup > Updates** shows the version you are running, a **Check for updates** button and a switch, **Check for updates automatically**, on by default. With it on, HAI looks for a newer version when it starts and once a day, and sends nothing but what any web request carries. With it off it only looks when you press the button.
- When there is a newer version the top bar shows a pill (**Update 1.1.0 available**); pressing it opens the Updates group. Nothing is downloaded until you press **Download**, with a progress bar.
- A downloaded update is checked against the hash in the release's feed (and, for a signed release, the publisher's signature). One that does not match is thrown away, you are told, and the version you have keeps working.
- **Restart to update** ends the bridge and its agents and installs the new version. While an agent is working it is held ("Restart when the agent finishes"). Closing the app without pressing it changes nothing.
- A copy running from the repository says updating is not available.

Your projects, settings and voice models are not touched by an update.

`pnpm --filter @hai/desktop run test:update` runs one real update with the real updater: it builds two unsigned copies of the app (0.0.1 and 0.0.2) under another name, installs the first, serves the second as a release feed from this computer, drives the installed app through check, download and restart, checks that the program on disk is now 0.0.2 and that the new version started, then removes everything. The updater's own checks of the download are electron-updater's; the end-to-end tests of what HAI does around them use a stand-in for it (`apps/desktop/test/updates-deps-fake.ts`, swapped in by the test build only).

## Where things are

| What | Where |
|---|---|
| Settings, the session file, agent conversations, the sample project | `%APPDATA%\HAI\.hai` (Electron's user data folder for the app) |
| The desktop app's own settings (automatic update checks) | `%APPDATA%\HAI\desktop.json` |
| Logs | `%APPDATA%\HAI\logs`, one file per day, the last seven kept |
| Voice models, once downloaded | `%APPDATA%\HAI\models` |
| The program | the install folder, which is never written to |

Updating or reinstalling replaces the program and leaves the user data folder alone. The logs hold what the app and the bridge print; they never hold the session token or camera frames.

## Test it

```sh
pnpm test                       # unit tests, including apps/desktop
pnpm test:e2e:desktop           # the app, started from a staged folder, driven by Playwright
pnpm test:e2e:desktop:packaged  # the same tests against the program electron-builder makes
```

The first-run tests (`e2e/desktop-first-run.spec.ts`) play the whole first run, from a machine with no Claude Code to an agent that answers. The test build of the app has a stand-in for Anthropic's installer and for the sign-in window (`apps/desktop/test/claude-deps-fake.ts`, swapped in by the build and never in the app you install), so nothing is installed or signed in. The same tests download the voice models from a small local server (`e2e/model-server.ts`) that serves the real files from `apps/web/public`, so the real checksums are checked. The test build of the app is told to use it when it is built (`modelsBaseUrl` in `apps/desktop/scripts/bundle.ts`); the app you install has no such setting. The screen's own states are tested in the browser, with a stand-in for the desktop app, in `e2e/first-run.spec.ts` and `e2e/visual/first-run.visual.spec.ts`.

Both end-to-end commands build what they test first (a few seconds for the staged app, a little longer for the packaged one). They use Chromium's fake camera fed from the recorded clips, and a fake Claude Code in place of the real one, so no camera, account or network is needed. One test in each run is skipped on purpose: the dev server test only makes sense for the staged app, and the test that an installed app ignores `HAI_DESKTOP_DEV_URL` only for the packaged one.
