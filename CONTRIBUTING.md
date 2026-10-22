# Contributing

Thanks for helping. HAI is built in public, in small weekly steps.

## Setup

Requirements: Node 24, pnpm 10, ffmpeg (to prepare the recorded test clips), and Microsoft Edge or Chrome.

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the local bridge and the web app. Open http://127.0.0.1:5173.

## Before you open a pull request

```sh
pnpm lint          # Biome lint + format check (pnpm format fixes most issues)
pnpm typecheck     # TypeScript, every package
pnpm test          # unit tests (Vitest)
pnpm test:e2e      # end-to-end tests (Playwright, uses a fake camera)
pnpm licenses:check
```

The end-to-end tests start their own bridge and dev server (ports 4880 and 5183, state in `.hai/e2e`), so they never touch the `pnpm dev` you work with: your agents, settings and project are left alone while they run.

CI runs the same commands on Windows and Ubuntu. Please keep them green: no new lint warnings, no skipped or flaky tests.

## How work is planned

Changes are specified with [OpenSpec](https://github.com/Fission-AI/OpenSpec) under `openspec/changes/`. Each change has a proposal, specs, a design and a task list, and ends with a short demo script in `demos/`. To propose something new, open an issue first or draft an OpenSpec change.

## Ground rules

- Camera frames never leave the perception worker. Do not add code that sends images anywhere.
- Never read or handle LLM credentials. See [PROVIDERS.md](PROVIDERS.md).
- No GPL, AGPL or non-commercial dependencies or model weights in shipped code. `pnpm licenses:check` enforces this.
- Gesture navigation must never wait on the agent.

By contributing you agree that your contributions are licensed under the Apache License 2.0.
