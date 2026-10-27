# HAI - Human AI Interface

**Hands, face and voice for AEC agents.** HAI (Human AI Interface) is an open-source interaction layer that lets AEC professionals work with their own AI agent and their design software using a normal laptop webcam: point at a wall, say "make it 300 thick", nod to accept.

> Status: week 12 of a 19-week build in public. Hand and face tracking, both hands as equal pointers, gestures, hand navigation, tool rings with hand-drawn walls, slabs and columns, your own Claude as a small design team (Mochi and its specialists), on-device voice in and out, an Apple-style studio layout with feature switches and a "show my hands" overlay for recordings, pointers that snap to buttons, drawing aids (snap, ortho, projection) import of Rhino .3dm models, snapping and measuring at every height, new empty projects and saving as a Rhino file all work in the built-in viewer. Next: the Rhino 8 connector.

Watch the build stage by stage, each with its clip and LinkedIn post, at [hai.spairl.si](https://hai.spairl.si). The site's source is in [website/](website/).

## Download

**On Windows:** download the installer from the [releases page](https://github.com/sahilyousafp/HAI_Human_AI_Interaction/releases/latest) and double click it. It installs for you only and needs no administrator rights. The first screen walks you through installing Claude Code and downloading the voice models. You need a Claude account for the agent; the camera and the viewer work without one. Details, and how to build it yourself, are in [docs/desktop.md](docs/desktop.md); shipping a new version is in [docs/releasing.md](docs/releasing.md).

Windows installers are signed with a certificate from the SignPath Foundation, using SignPath.io (see the [code signing policy](#code-signing-policy)). The v1.0.0 pre-release was published before signing was set up and is unsigned, so Windows 11 with Smart App Control on blocks it.

**To work on HAI:** see "Run it" below.

## Why

AI agents can already drive design tools, but talking to them still means typing into a chat box. HAI keeps the precise modelling in tools like Rhino and rethinks how you direct the agent: with your hands, your head and your voice.

## Privacy

- Camera video is processed on your machine, inside the browser. It is never recorded or uploaded.
- Everything runs on `127.0.0.1`, except the open-data requests you switch on (Settings > Open data, off by default), which carry a place and never your work. See [SECURITY.md](SECURITY.md) and [docs/open-data.md](docs/open-data.md).
- HAI uses your own installed and signed-in Claude Code and never touches your credentials. See [PROVIDERS.md](PROVIDERS.md).

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

- **What is signed:** the Windows installer (`HAI-Setup-<version>.exe`) and the program inside it, built from this repository by the [release workflow](.github/workflows/release.yml). Only release builds made from a version tag are submitted for signing.
- **Roles:** Sahil Yousaf ([sahilyousafp](https://github.com/sahilyousafp)) is the author, reviewer and approver. Every signing request is approved by hand before a release is published.
- **Privacy:** HAI sends nothing to any server of its own. Camera video and microphone audio are processed on your machine and never leave it. The agent runs through your own installed and signed-in Claude Code, so what you ask the agent goes to Anthropic under your account. The browser's cloud speech service is off unless you turn it on, and then your browser sends what you say to its vendor. See [Privacy](#privacy), [docs/perception.md](docs/perception.md) and [docs/voice.md](docs/voice.md).

## Requirements

- Windows 11 (primary), macOS or Linux
- Node 24 and pnpm 10 (only to work on HAI; the installer needs none of it)
- Microsoft Edge or Chrome
- A webcam
- [Claude Code](https://claude.com/claude-code), installed and signed in, for the agent team
- Rhino 8 (optional, from week 13: HAI's own plugin connects it and runs the agent's Python in it)
- Python 3.10 or newer (optional, from week 13: the agent's Python workbench, with libraries such as Ladybug)

## Run it

```sh
pnpm install
pnpm dev
```

Open http://127.0.0.1:5173. The header shows **Connected** when the web app has reached the local bridge.

To run the desktop app instead (one window, the bridge started for you), use `pnpm dev:desktop`. See [docs/desktop.md](docs/desktop.md).

### Coming from AEX

HAI was called AEX until week 12. Nothing is lost: when the bridge starts, an old `.aex` folder becomes `.hai` (settings, sessions, the always-allowed tools, the team), and a project folder's `scene.aex.json` and `assets/*.aexmesh` take their new names the first time the project opens. Saved tool names follow the app's tool server from `mcp__aex__` to `mcp__hai__`. What does not carry over: environment variables are now `HAI_*` (`AEX_WORKSPACE` is `HAI_WORKSPACE`, and so on), and a few view choices kept in the browser (camera view minimised, last settings page) start from their defaults.

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
| 8 | Mochi and the agent team: named specialists, status, spoken replies |
| 9 | Both hands as equal pointers; the left hand's create ring: walls, slabs, columns |
| 10 | Studio UI: settings sheet, floating camera, feature switches, show my hands |
| 11 | Precision and import: pointers snap to buttons, drawing aids (snap, ortho, projection), Rhino .3dm import |
| 12 | Snapping at every height, Measure that snaps, new empty projects, save as 3dm |
| 13 | Rhino 8 connector |
| 14 | More modelling by hand: openings, roofs, arrays |
| 14b | Hold to talk: a long pinch says "this" and listens; rings by role; sketches and markers for the agent; tool names by voice |
| 15 | Reviewable agent turns: nod to keep, shake to revert |
| 16-19 | More providers, overlay over Rhino, custom gestures, v0.1 |

The full plan is in [docs/PLAN.md](docs/PLAN.md), with research notes in [docs/research](docs/research) and the reasoning behind the architecture in [docs/decision](docs/decision/index.html). Work is specified with OpenSpec: current behaviour in [openspec/specs](openspec/specs), planned changes in [openspec/changes](openspec/changes).

## Repository layout

```
apps/web            browser app: HUD, viewer, camera
apps/bridge         local bridge: WebSocket hub, agent process, MCP tools
apps/desktop        desktop app: one window, the bridge started for you, the installer
packages/protocol   message schemas shared by every process
packages/scene      architectural scene model
packages/perception tracking filters and gesture recognisers
packages/agent-core agent provider interface
demos/              one script per weekly demo clip
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [Apache-2.0](LICENSE).
