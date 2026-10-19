# Design

## Context

Greenfield repo on Windows 11 with Node 24.19 and pnpm 10.34 installed. The architecture is fixed in `docs/PLAN.md` (hybrid: own interaction layer, external hosts through MCP). This change lays down the skeleton every later change plugs into.

## Goals / Non-Goals

**Goals:**
- One command to run everything locally, one command to test everything.
- Package boundaries that let perception, scene and agent logic be unit-tested without a browser or a camera.
- A local security baseline (loopback only, session token, Origin check) that later changes inherit instead of retrofitting.

**Non-Goals:**
- Production packaging (Electron arrives with the overlay change).
- Publishing packages to npm.

## Decisions

**Workspace layout**

```
apps/web            Vite + React app (HUD, viewer, perception worker host)
apps/bridge         Node 24 process: WebSocket hub, MCP HTTP endpoint, agent process manager
packages/protocol   zod schemas + types for every message crossing a process boundary
packages/scene      scene document model and pure operations (no DOM, no three.js)
packages/perception filters, gesture state machines, worker entry (pure TS core, thin worker shell)
packages/agent-core AgentProvider interface and providers
plugins/rhino       C# RhinoCommon plugin (added in add-rhino-connector)
demos/              one script per demo clip (setup, steps, expected result)
test-assets/clips   recorded .y4m webcam clips for fake-camera E2E tests (CC BY 4.0, recorded by the maintainer)
```
Rejected: a single app package (perception and scene logic would be untestable without a browser); Nx or Turborepo (pnpm `-r` scripts are enough at this size).

**Protocol first.** All cross-process messages are zod schemas in `packages/protocol`, validated on receipt on both sides. Rejected: hand-written TS types only (no runtime validation at the trust boundary).

**Tooling.** Biome for lint and format in one fast tool (rejected: ESLint + Prettier, two configs and slower). TypeScript strict mode with `tsc --noEmit` per package. Pin TypeScript 7.x; if a dependency's types break under the native compiler, pin to the latest 6.x and record why in `docs/decisions.md`. Vitest for unit tests. Playwright for E2E.

**Fake camera for E2E.** Chromium flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<clip>.y4m` feed recorded clips into `getUserMedia`, so gesture tests run in CI without a person or a webcam. The bootstrap smoke test only proves the harness launches; clips arrive in `add-perception-tracking`.

**Local security baseline.** The bridge listens on `127.0.0.1` only. At start it creates a 32-byte random token. WebSocket upgrades must carry the token and an Origin in an allow-list (the Vite dev origin, later the bridge's own origin). In dev, the bridge writes `{port, token}` to `.aex/session.json` (git-ignored) and a small Vite plugin injects it into the page. Rejected: no token (any local web page could drive the agent through `ws://localhost`).

**Dev orchestration.** Root `pnpm dev` runs `apps/bridge` (tsx watch) and `apps/web` (Vite) in parallel with `pnpm -r --parallel`. Root `pnpm test` runs unit tests; `pnpm test:e2e` runs Playwright, which starts both servers itself.

**CI.** GitHub Actions matrix `windows-latest` and `ubuntu-latest`: install, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. Windows is in the matrix because it is the primary platform (child process spawning and paths differ).

**Licence and notices.** Apache-2.0 with `NOTICE`. A `pnpm licenses:check` script fails CI if a production dependency is GPL, AGPL or non-commercial.

## Risks / Trade-offs

- [TypeScript 7 native compiler is new] → Pin exact version; documented fallback to 6.x.
- [Fake-camera behaviour differs from a real webcam (exposure, frame timing)] → E2E tests assert behaviour, not frame rate; real-camera checks stay in the demo scripts.
- [CI minutes on Windows runners are slower] → Cache the pnpm store and Playwright browsers.

## Open Questions

- Final product name. `@aex/*` (AEC Agentic eXperience) is a working scope; renaming later is a search-and-replace.
