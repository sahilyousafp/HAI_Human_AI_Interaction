# AEX

**Hands, face and voice for AEC agents.** An open-source interaction layer that lets an architect work with their own AI agent and their design software using a normal laptop webcam: point at a wall, say "make it 300 thick", nod to accept.

> Status: week 1 of a 13-week build in public. The workspace, local bridge and CI are in place. Camera tracking arrives in week 2.

## Why

AI agents can already drive design tools (McNeel ships an official Rhino MCP server), but talking to them still means typing into a chat box. AEX keeps the precise modelling in tools like Rhino and rethinks how you direct the agent: with your hands, your head and your voice.

## Privacy

- Camera video is processed on your machine, inside the browser. It is never recorded or uploaded.
- Everything runs on `127.0.0.1`. See [SECURITY.md](SECURITY.md).
- AEX uses your own installed and signed-in Claude Code and never touches your credentials. See [PROVIDERS.md](PROVIDERS.md).

## Requirements

- Windows 11 (primary), macOS or Linux
- Node 24 and pnpm 10
- Microsoft Edge or Chrome
- A webcam (from week 2)
- [Claude Code](https://claude.com/claude-code), installed and signed in (from week 5)
- Rhino 8 with the Rhino MCP Platform plugin (optional, from week 7)

## Run it

```sh
pnpm install
pnpm dev
```

Open http://127.0.0.1:5173. The header shows **Connected** when the web app has reached the local bridge.

## Roadmap

| Week | Milestone |
|---|---|
| 1 | Workspace, local bridge, CI |
| 2 | Hand and face tracking in the browser |
| 3 | Gesture vocabulary: engage, pinch, clutch, nod |
| 4 | Navigate a 3D model with your hands |
| 5 | Gesture tool palette: move, measure, section, add massing, no AI needed |
| 6 | Your own Claude edits the model; your MCP servers and skills included |
| 7 | Point and speak |
| 8-9 | Rhino 8 connector and reviewable agent turns |
| 10-13 | More providers, overlay over Rhino, custom gestures, v0.1 |

The full plan is in [docs/PLAN.md](docs/PLAN.md), with research notes in [docs/research](docs/research) and the reasoning behind the architecture in [docs/decision](docs/decision/index.html). Work is specified with OpenSpec in [openspec/changes](openspec/changes).

## Repository layout

```
apps/web            browser app: HUD, viewer, camera
apps/bridge         local bridge: WebSocket hub, agent process, MCP tools
packages/protocol   message schemas shared by every process
packages/scene      architectural scene model
packages/perception tracking filters and gesture recognisers
packages/agent-core agent provider interface
demos/              one script per weekly demo clip
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [Apache-2.0](LICENSE).
