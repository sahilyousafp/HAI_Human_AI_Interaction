# Tasks

## 1. Workspace and toolchain

- [x] 1.1 Create root `package.json`, `pnpm-workspace.yaml`, `.gitignore` (includes `.aex/`, `node_modules`, `test-results`), `.editorconfig`, `.nvmrc` (24); verify `pnpm install` succeeds on a clean clone
- [x] 1.2 Add `tsconfig.base.json` (strict) and empty packages `packages/{protocol,scene,perception,agent-core}` with `src/index.ts`; verify `pnpm typecheck` passes for every package
- [x] 1.3 Add Biome config and root scripts `lint`, `format`; verify `pnpm lint` passes and flags a deliberately bad sample file
- [x] 1.4 Add Vitest workspace config with one passing test per package; verify `pnpm test` runs all of them
- [x] 1.5 Add `pnpm licenses:check` that fails on GPL, AGPL or non-commercial production dependencies; verify it fails when a GPL package is temporarily added

## 2. Protocol and bridge skeleton

- [x] 2.1 In `packages/protocol`, define the envelope schema (`type`, `id`, `payload`) plus `hello` and `bridge.status` messages with zod; verify unit tests accept valid and reject malformed messages
- [x] 2.2 Create `apps/bridge`: HTTP + `ws` server bound to 127.0.0.1, random session token, Origin allow-list, writes `.aex/session.json`; verify unit tests show connections without token, wrong token or foreign Origin are refused
- [x] 2.3 Verify the bridge refuses to bind to any non-loopback address with a test that asserts the listening address is 127.0.0.1

## 3. Web shell

- [x] 3.1 Create `apps/web` with Vite + React + TypeScript and a Vite plugin that injects `{port, token}` from `.aex/session.json`; verify `pnpm dev` serves the page
- [x] 3.2 Show bridge connection state (connecting, connected, refused) in the shell header; verify by starting and stopping the bridge while the page is open
- [ ] 3.3 Add root `pnpm dev` that runs bridge and web in parallel; verify one command brings both up and Ctrl+C stops both on Windows

## 4. End-to-end harness and CI

- [x] 4.1 Configure Playwright (Chromium) to start bridge and web and launch with the fake-camera flags; add a smoke test asserting the shell reaches "connected"; verify `pnpm test:e2e` passes locally
- [x] 4.2 Add `.github/workflows/ci.yml` (windows-latest, ubuntu-latest): install, lint, typecheck, test, licenses:check, test:e2e, with pnpm and Playwright caches; verify a green run on a pushed branch

## 5. Open-source documents

- [x] 5.1 Add `LICENSE` (Apache-2.0), `NOTICE`, `CONTRIBUTING.md`, `SECURITY.md` (loopback-only, token, how to report); verify links in README resolve
- [x] 5.2 Add `PROVIDERS.md`: the agent is the user's own installed and logged-in `claude`, spawned unmodified; credentials are never read, stored or proxied; other providers are planned behind the same interface; verify wording contains no claims of affiliation with Anthropic or McNeel
- [x] 5.3 Write `README.md` (what it is, privacy promise, requirements, `pnpm dev`, roadmap link to `docs/PLAN.md`, decision page link); verify a fresh clone can follow it to a running shell

## 6. Demo

- [ ] 6.1 Write `demos/01-decision-and-setup.md` (decision page walkthrough, repo tour, green CI) and record the Week 1 clip "Why I'm not building a Rhino plugin"; verify the script can be followed start to finish in under 10 minutes

## Workflow follow-up

- Archive the change after the Week 1 clip is published.
