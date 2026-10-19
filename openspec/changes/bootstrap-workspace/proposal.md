# Proposal

## Why

The repository is empty. Every later change (tracking, gestures, agent, Rhino) needs the same workspace, toolchain, test harness and local security model. Setting them up once, with CI from day one, keeps the 6-hour weeks spent on features and keeps lint, type and test failures from piling up unnoticed.

## What Changes

- pnpm workspace with the package layout from `docs/PLAN.md`: `apps/web`, `apps/bridge`, `packages/protocol`, `packages/scene`, `packages/perception`, `packages/agent-core`, plus `plugins/rhino`, `demos/`, `test-assets/` and `docs/`. Working package scope: `@aex/*`.
- Shared toolchain: TypeScript (strict), Biome for lint and format, Vitest for unit tests, Playwright for end-to-end tests with Chromium's fake camera.
- `pnpm dev` starts the web app and the bridge together. The bridge generates a random session token and only accepts WebSocket connections from 127.0.0.1 with that token and an allowed Origin.
- A minimal web shell that connects to the bridge and shows the connection state, proving the round trip.
- GitHub Actions CI on Windows and Ubuntu: lint, typecheck, unit tests, end-to-end smoke test.
- Open-source basics: Apache-2.0 `LICENSE`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `PROVIDERS.md` (how each LLM route is used and why credentials are never touched), `NOTICE`.

Out of scope: camera access, gestures, any 3D viewer, agent spawning, the Rhino plugin code. Those arrive in later changes. No packaging or installers.

Demo clip (Week 1): "Why I'm not building a Rhino plugin": a walk through the decision page and the empty-but-green repo with CI passing.

## Capabilities

### New Capabilities

None. This change is tooling and scaffolding only and sets `skip_specs: true`. The local-security behaviour of the bridge becomes a spec in `add-claude-agent-bridge`, where it first protects something.

### Modified Capabilities

None.

## Impact

- New repository structure, root `package.json`, `pnpm-workspace.yaml`, `biome.json`, `tsconfig.base.json`, `.github/workflows/ci.yml`.
- Dependencies: TypeScript, Vite, React, Biome, Vitest, Playwright, `ws`, zod.
- Requires Node 24 and pnpm 10 on the maintainer's machine (both already installed).
