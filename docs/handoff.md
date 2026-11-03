# Handoff: where the work stands and how to carry on

This page is for whoever picks the project up next, a person or a new chat with an agent. It says what the repository is, how work is done here, what the machine and CI do to you, what was last finished, and what is open. Everything else is in the other docs; this page points at them. Keep it current: change it in the same commit as the work it describes.

## The project in one paragraph

HAI (Human AI Interface) is an open-source layer for directing AEC agents with hands, face and voice. A pnpm monorepo: `apps/web` (React, three.js viewer, tools, voice), `apps/bridge` (Node server and MCP tools, the agent team), `apps/desktop` (Electron installer), `plugins/rhino` (C# plugin), `packages/{protocol,scene,perception,agent-core}`, `openspec/` (specified changes), `docs/`, `e2e/` (Playwright). Start with [README.md](../README.md), then [agents.md](agents.md), [tools.md](tools.md), [gestures.md](gestures.md) and [voice.md](voice.md). Why things are the way they are: [decisions.md](decisions.md), newest at the end.

## How work is done here

- **Branches, merges, pushes.** Work on a short branch, merge it into local `main` with `git merge --no-ff`, delete the branch. **Push to `main` only when the owner says so**; each push is authorised separately. Check `git branch --show-current` before committing: another session may share the checkout and switch branches (worktrees are safer).
- **Stage explicit paths, never `git add -A`.** The tests regenerate `test-assets/models/*.3dm`, which always show as modified; leave them. `.agents/` is untracked and not ours.
- **Commit messages** explain why, end without any co-author line, and never use the em dash (use a plain dash). `CHANGELOG.md` is generated: do not edit it.
- **Before pushing**, run all of: `pnpm lint`, the full `pnpm typecheck` (it also runs `tsc -p tsconfig.e2e.json`), the unit tests (`pnpm test`, or `pnpm exec vitest run` inside a package), and the Playwright specs your change touches. Check Biome's exit code, not just its summary.
- **Bug fixes start with a test that fails** in the way a user would see it, then the fix. A fix is not done until the new test fails on the old code and passes on the new.
- **Be picky about the UI.** Screenshot at 1280, 1024 and 900 px wide and look at them. `e2e/hud-layout.spec.ts` checks that no panel over the model covers another.
- **Lint warnings, failing tests and flaky tests get fixed even when your change did not cause them.**
- **Changes are specified with OpenSpec** (`openspec/changes/`, see [CONTRIBUTING.md](../CONTRIBUTING.md)). `openspec list` shows what is open.

## The machine and its traps (Windows 11, the reference setup)

- **Smart App Control blocks fresh unsigned binaries.** Playwright's bundled Chromium will not start natively, so local runs use Edge: `HAI_E2E_CHANNEL=msedge` is the default locally (`playwright.config.ts`). OpenCascade (`cadquery-ocp`) and the Python `rhino3dm` tests cannot run here either: `python-run`, `python-tools` and `python-written-3dm` fail locally and pass in CI. That is not a regression.
- **Run Playwright one spec file at a time.** The whole suite exhausts memory here. `pnpm exec playwright test e2e/<file>.spec.ts --project=chromium --retries=0`; the voice fixtures are `--project=voice:<fixture>`, the screenshots `--project=visual` (Windows only, baselines are `*-win32.png`).
- **To reproduce Linux or CI timing**, use Docker: the image `mcr.microsoft.com/playwright:v1.64.1-noble` plus ffmpeg and pnpm 10, a volume holding a Linux checkout, `CI=true`, `--cpus=4 --memory=6g --ipc=host`. Two CPUs is harsher than CI, four is close. Docker's memory (`vmmemWSL`) can hold gigabytes of page cache: `wsl -d docker-desktop -e sh -c "sync; echo 3 > /proc/sys/vm/drop_caches"` frees it. The image and volume that were used are deleted; rebuild them only when a CI-only failure needs it.
- **Git Bash heredocs lose backslashes and quotes.** Write regexes and files with an editor tool or a script file. A Python text write can produce CRLF: strip it (`sed -i 's/\r$//'`) in files that were LF.
- **Windows paths in Node:** use `C:/Users/...` or `D:/...`, not `/c/Users/...`.

## CI

`.github/workflows/ci.yml` runs on `windows-latest` and `ubuntu-latest` (lint, typecheck, unit tests, licences, credential boundary, `pnpm assets`, e2e) and builds the Rhino plugin. A run takes 45 to 90 minutes.

- List runs: `gh run list --branch main --limit 5`. A job's log: `gh api --allow-escape-sequences repos/sahilyousafp/HAI_Human_AI_Interaction/actions/jobs/<job id>/logs`, then strip the colour codes. The summary near the end lists the failed and flaky specs.
- **Failure artifacts** (traces, screenshots, error context) are uploaded only on failure. `gh run download` stalls on the large Windows one: get the signed address with `curl -sI -H "Authorization: Bearer $(gh auth token)" https://api.github.com/repos/<repo>/actions/artifacts/<id>/zip` and download it with `curl -C - --retry 30 --retry-all-errors`. A trace's console and network are in the `*.trace` and `*.network` files inside `trace.zip`.
- **Timings:** `expect` waits 15 s on CI (5 s locally) and the visual project's tests get 120 s; a timing budget takes its limit from `allow(local, ci)` in `e2e/budget.ts`. Rendering on CI is software (SwiftShader); `drawsInSoftware(page)` says so.
- **The test bridge skips ports Chromium refuses** (5060 and others, `UNSAFE_PORTS` in `e2e/viewer.ts`); a bridge on one never connects.
- **The fake microphone** plays `test-assets/speech/silence.wav` in the chromium and visual projects, because Chromium's default one beeps and the speech detector takes a beep for a voice. The voice projects play their own fixture once.

### Where CI stood at the last look

The last run to finish (`a3940b8`, run 41038614697) had Ubuntu and the Rhino plugin green. Windows failed only the four hold-ring visual tests (`e2e/visual/tools.visual.spec.ts`, "hold to talk: the progress ring..."), plus flaky ones that pass on retry. Runs on `358459c` and `493db97` were cancelled when a newer push replaced them, so nothing since has a result except what is in progress: run 41220664551 on `7fbab0f` (or newer: `gh run list --branch main`) covers everything in the next section, namely clearing the context, the layout, the lasso, the new speech model and the mishearing fix. It is the first run to download the new speech model by its hash and the first to compare the regenerated screenshot baselines on the Windows runner. **Read it first.**

## What was finished in the last stretch

Newest first; each has its commit and, where it was a decision, a section in [decisions.md](decisions.md).

- **Lines you can place and edit, and selections that hold together** (`openspec/changes/add-line-editing-and-groups`, [tools.md](tools.md#groups)): one pinch places one point, Line locks to angles by default and has a Straight / Freeform toggle, Undo takes back a line's points, Move and Delete act on a line's points through handles, and lines are drawn at a width on screen. Groups (`hai.group`): tap selects all, an import is one group, a request about several elements groups them, agents cannot scatter one. Every tool acts on the whole selection (`actedOn`), with a new Rotate tool (key O) and an options card pinned to what is selected. Tested with synthetic hands only: **try one pinch, one point with a real camera first.**
- **Try now** ([try-now.md](try-now.md)): the website's hero button opens `/try/`, the app running in the visitor's tab with its own scene (`LocalBridge`, `SceneStore` moved to `packages/scene`), sample building, import and save of `.3dm`, hands, typed commands; no agent, voice or saving. `pnpm test:e2e:try`, in CI. To publish it: `npm run build:try` in `website/`, then deploy Slate from that machine.
- **Natural wording, array, corrections, multi-select move** ([voice.md](voice.md)): the offline commands read talk around them ("I'd like to move this two and a half metres to the right, thanks"), an axis letter plus a way ("5 m to the y axis towards right"), `array 5 times` (side by side), and a correction of the last number ("make it 4 m", "no, 3 times", "actually 45 degrees": undo and redo with the new number, only while nothing else changed the model, `CommandMemory` in `apps/web/src/commands/run.ts`). The Move tool carries the whole selection. A 630-phrase set (`test-assets/commands/phrases.json`, built by `scripts/make-command-phrases.mjs`, held to the grammar by `apps/web/src/commands/phrases.test.ts`) found about 70 gaps that are now fixed; it is also the set to measure a fallback language model against. Why the models are ONNX: `docs/decision/onnx.html`.
- **Mishearings put right by sound** ([voice.md](voice.md#mishearings)): a transcript that is not a tool name or a command is retried with words swapped for the app's own words that sound alike, and kept only if the app then understands it in full. `apps/web/src/voice/lexicon.ts`, `heard.ts`. The grammar also reads "4 x 6 m" as four times six metres.
- **Speech model: Moonshine v2 small replaces Moonshine base** (decisions.md, "Speech to text: Moonshine v2 small..."). Measured on 136 spoken commands: word errors 6.2 to 2.4 per cent, every number right, tool names right 95 times in 100 instead of 75; about 0.32 s per utterance. The model folder is `models/moonshine-small` (170 MB, 496 MB with the spoken replies), pinned by revision and SHA-256 in `scripts/assets.lock.json`.
- **Lasso select** in the other hand's ring (top left, `G`): a pinch-drag loop selects what is inside and the tool turns itself off. `apps/web/src/tools/lasso.ts`.
- **Clear context**: `context_clear` for every agent and a Clear button in Settings > Open data.
- **Panel layout beside the chat rail**: no panel over the model covers another at 1280, 1024 or 900 px (`e2e/hud-layout.spec.ts`); every screenshot baseline was regenerated.
- **A long run of CI fixes**: the mic stuck on after a too-short sound (a real bug), slow-runner timing in many specs, the Remove button hidden by the status bar, the unsafe-port bridge.
- Earlier, all in the docs: hold roles, the chat rail, the Line tool and view cube, spoken commands, the OpenCascade geometry kernel, markers and named views, approval badges, agent faces.

## Open, in the order to take them

1. **Read the CI runs above** and fix what they show.
2. **The four Windows hold-ring visual tests** still time out even at 120 s. The trace shows each wait after the speech detector starts taking longer than the one before (12 s, 20 s, 42 s). Not reproduced locally, not caused by the microphone stream (tried), not by CPU throttling (tried six times). Next step that was not taken: log the page's event-loop lag and the detector's frame rate inside those tests and read them after one Windows run. Do not skip the tests to get green.
3. **`voice:undo` flakes on Windows CI**: the fake microphone plays its fixture once, from when the page opens it, and the speech detector can take 20 s or more to be ready there, so a short phrase is over. Padding the audio with silence does not work (listening gives up after 8 s of silence). A fix has to align the microphone's opening with the detector's readiness.
4. **Spoken commands that were planned and not built**: "ortho on/off", "angle 45", "length 3 metres", "top view", "front view", "perspective". They exist only as the constraints panel and the view cube. See the plan in `openspec/changes/add-line-tool-and-view-cube`.
5. **The speech model is measured on synthetic voices only.** Real speakers, accents and a noisy room were not tested; the fixtures in `test-assets/speech` are synthetic too. The only ONNX export transformers.js loads is one person's (Workmind, MIT, pinned by hash). Move to an official export when `moonshine_streaming` is supported or Useful Sensors publish one. Moonshine v2 medium has no loadable export.
6. **Screenshot tolerance is loose** (2 to 6 per cent of pixels), which let stale baselines pass. Tightening it may make CI flaky between local Edge and the Windows runner; try it with a run to watch.
7. **Narrow layouts**: between 860 and about 1100 px the chat rail leaves a small model view; the panels now fit but are tight. Below 860 px the rail becomes a bottom sheet.
8. **Housekeeping**: leftover plain folders `AEC_wt_*` next to the checkout (unregistered worktrees, safe to delete); an old `models/moonshine-base` folder in a user's data folder is no longer used.

## Rules from the owner that are easy to forget

Never the em dash. No co-author line in commits. Prefer quality, simplicity, robustness and maintainability over development cost. UI proposals go to the owner as options in an Artifact to pick from. Push only when told.
