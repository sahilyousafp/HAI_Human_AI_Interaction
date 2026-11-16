# Plan: gesture + agent interaction layer for AEC

Decided 2026-10-19, updated the same day with the gesture tool palette, on 2026-10-21 with the agent team, two-hand input and hand modelling tools, and on 2026-11-16 with the turn to orchestration: hosts model, HAI views and edits. Research notes: `docs/research/` (the latest is [host-connectors.md](research/host-connectors.md)). Interactive decision page: `docs/decision/index.html`. Every milestone is specified as an OpenSpec change under `openspec/changes/`.

## Decision

**An orchestrator, not a modeller (2026-11-16).** HAI is the interaction layer and the one place to look: camera, gestures, voice, tool rings, HUD, the viewer and the agent loop. The modelling is done by the user's own design applications, each with its own tools: Rhino for form and NURBS, Blender for visualisation and mesh work, Revit for BIM and documents. Others can follow through the same contract.

- **The Claude agent orchestrates.** Mochi breaks a request into tasks, each for one host, and sequences the hand-offs.
- **Specialists drive the hosts by writing code in them.** Each run is shown to the user and approved before it runs, and is one undo record in the host.
- **Every host's model is mirrored live into HAI's viewer.** The user selects, moves, rotates, deletes and undoes host objects there. A zone with the host's glyph shows where a host is working.
- **Speckle carries models between hosts.** HAI's own plugins publish and load through the Speckle SDKs, so no connector needs a click.
- **HAI's own scene holds only sketches, markers, views and references.**
- **Other plugins and MCP servers add capabilities.** The user can connect them beside HAI's connectors, and each is offered to the agents working on its host.
- **Generated panels** can read the web through the bridge, show sourced images and be worked fully by hand.

Browser-first, with an Electron desktop app (`apps/desktop`) as the way to give it to someone: a signed installer that starts the bridge, serves the web app and walks a first-time user through Claude Code and the voice models (see [desktop.md](desktop.md)). The decision and its evidence: [decisions.md](decisions.md), "HAI orchestrates host applications".

Why:
- The novel part is the interaction layer. No maintained webcam-gesture + LLM-agent CAD/BIM tool exists.
- The hosts already model, document and render better than an agent building geometry call by call. An agent writing code in the host beats one calling a fixed tool list (CodeAct: up to 20 points), and pictures of its own work improve its results.
- The host vendors' MCP servers have no approval gate and no single undo per run. Revit's server cannot run code at all. So HAI keeps its own thin connector per host.
- MediaPipe runs best in the browser on Windows (GPU delegate); Python GPU is Linux-only.
- A from-scratch modeler means months rebuilding NURBS, booleans and IFC. The first plan avoided that too, but still had agents and hands build walls and slabs in HAI's own scene. That part is now dropped.

## Architecture

```
apps/web (Vite + React + R3F)       camera -> perception -> gestures -> rings, edit tools, navigation, HUD,
                                    viewer with one live mirror per host, zones, sketches
apps/bridge (Node)                  WebSocket hub, host registry, agent processes, MCP host tools, approvals,
                                    Speckle (GraphQL: projects, models, new-version events)
apps/desktop                        Electron app and installer: the window, the bridge, first run, updates
packages/protocol                   shared zod schemas for every cross-process message, the host contract
packages/perception                 MediaPipe worker, One Euro filter, gesture state machines
packages/scene                      sketches, markers, views and references, transactions, undo
packages/agent-core                 AgentProvider: ClaudeCli now; Codex, ACP, local models later
plugins/rhino (C#)                  mirror, selection, Python runner, edits, capture, images, Speckle SDK
plugins/blender (Python, GPL-3)     the same contract in Blender (later)
plugins/revit (C#)                  the same contract in Revit, C# runs through ExternalEvent (later)
```

Three speeds of control:
- **Gestures and head pose:** navigation, pointing, selection, confirm/reject. Local, no LLM, under 50 ms.
- **Tool rings:** a long pinch opens a radial menu of direct edits on host objects (select, move, rotate, delete, undo, measure, section) and references for the agent (sketch, marker, lasso, zone). The owning host applies an edit. No LLM.
- **Voice + agent:** intent-level work. The agent writes code in a host and the user approves it; each turn is reviewed (nod to keep, shake to revert).

The user's own Claude Code setup (MCP servers, skills) loads in the agent session; tools that are not pre-approved ask the user in the HUD. Only landmarks and intents leave the perception worker; video and audio never leave the device.

## LLM provider rules

- Spawn the user's own, unmodified, self-logged-in `claude` binary (long-lived `-p --input-format stream-json --output-format stream-json`). One user, one install, nothing hosted or resold.
- Never read, store or proxy Claude credentials. No "Sign in with Claude". No vendor names in the product name.
- Codex (ChatGPT plan), local models and API keys come later behind the same interface.

## Timeline (about 6 build hours/week + 1.5 hours/week for two clips)

| Week | OpenSpec change | Tue demo clip | Fri build log |
|---|---|---|---|
| 1 | `bootstrap-workspace` | Why I'm not building a Rhino plugin | The research: libraries, datasets, the gap |
| 2 | `add-perception-tracking` | 21 hand + 478 face points, on-device | MediaPipe in a Web Worker on a laptop iGPU |
| 3 | `add-gesture-recognition` | Jitter before and after; a pinch that never misfires | Pinch: 0.25 in, 0.35 out |
| 4 | `add-gesture-viewport-navigation` | Orbiting a building with one hand | Two-hand nav and gorilla arm |
| 5 | `add-gesture-tool-palette` | Tools in the palm of your hand | Marking menus: why direction beats aiming |
| 6 | `add-claude-agent-bridge` | First agent edit | Your MCP servers, skills and approvals by nod |
| 7 | `add-voice-point-and-speak` | "Make this wall 300 thick" | On-device speech and what "this" means |
| 8 | `add-mochi-agent-team` | "Mochi, ask Architect": a team of my own Claude | One session per agent: delegation, status, spoken replies |
| 9 | `add-two-hand-input` | Both hands: the left draws walls, the right navigates | Two pointers, two rings, and a stop that never fires by accident |
| 10 | `add-studio-ui` | A studio you can film: settings in a sheet, my hands drawn over the screen | Feature switches for every release |
| 11 | `add-precision-aids-and-3dm-import` | Drop in my Rhino model, then draw a wall that snaps to its corner | Snap, ortho and why a 48 000-object model becomes 14 elements |
| 12 | `add-3d-snapping-and-project-files` | From a blank project to a Rhino file | Snapping in 3D: matching on screen, not on the ground |
| 13 | `add-rhino-connector` | Same gestures drive Rhino 8, and the agent writes Python | Why Python instead of a tool list: Ladybug, rhino3dm and anything else |
| 14 | `add-modelling-tools` (to specify) | Openings, roofs and arrays by hand | Snapping inside Rhino |
| 14b | `add-hold-to-talk` | Point, hold, speak: a long pinch says "this" and listens | Put-that-there with an LLM: rings by role, tool names without the agent |
| 15 | `add-agent-turn-review` | The agent proposes, I nod | One undo per agent turn, in Rhino too |
| 16 | providers (to specify) | Same task, three models | The AgentProvider interface |
| 17 | overlay (to specify) | HUD floating over Rhino | Click-through windows on Windows |
| 18 | custom gestures (to specify) | Training my own gestures | Landmarks to LiteRT.js |
| 19 | release v0.1 (to specify) | Launch reel | Lessons + how to contribute |

Weeks 1-8 are built and their changes archived (`openspec/specs/` holds the current specs); weeks 9, 10, 11 and 12 are built and wait for their clips. Weeks 14 and 16-19 get their OpenSpec changes once the weeks before them have taught us what they need. After v0.1: Blender/Bonsai IFC connector, coarse gaze (WebEyeTrack), dynamic gestures, a small user study.

### The orchestration changes (from 2026-11-16)

The turn to orchestration (`pivot-to-host-orchestration`) replaces weeks 14 and 17 of the table above. "More modelling by hand" no longer fits, and an overlay over Rhino is not needed now that Rhino's window can stay minimised. It adds these changes, in order:

1. `add-host-adapters`: one host contract (`host.*` messages, a host registry, `host_run`, `host_capture`, `host_place_image` and the rest), with Rhino as the reference adapter. It finishes the open plugin tasks of `add-rhino-connector`.
2. `make-hai-the-edit-surface`: the edit ring and the reference ring, edits on host objects applied by their host, and the scene write tools and creation tools removed.
3. `add-host-zones`: live zones with the host's glyph and the agent's state. The look is chosen by the owner from options first.
4. `add-image-flow`: pictures from HAI into a host, and the host's own captures back to the agent.
5. `add-capability-connectors`: other MCP servers and the hosts' own plugins as extra capabilities. It adds a catalogue per host, gives each server to the agents working on its hosts, and has each host report its installed plugins to `host_run`.
6. `extend-generated-panels`: web reads through the bridge from the sites on the offer card, openly licensed image search with attribution, and panels worked fully by hand (drag, scroll, hover, move and resize).
7. `add-blender-connector`: the add-on in `plugins/blender` (GPL-3).
8. `add-speckle-handoffs`: spikes, then hand-offs between hosts through the plugins' SDKs.
9. `add-revit-connector`: the add-in in `plugins/revit`.
10. `reshape-agent-team-as-orchestrator`: Mochi plans host tasks and hand-offs; specialists drive hosts.

`add-agent-turn-review` (week 15) stays, reviewed in the hosts.

### Clips to record

Each built week ends in a clip; its script is in `demos/`. Tick a week once its clip is posted.

- [ ] Week 1: `demos/01-decision-and-setup.md`
- [ ] Week 2: `demos/02-tracking.md`
- [ ] Week 3: `demos/03-gestures.md` (can be posted with week 2)
- [ ] Week 4: `demos/04-navigate.md`
- [ ] Week 5: `demos/05-tool-palette.md`
- [ ] Week 6: `demos/06-first-agent-edit.md`
- [ ] Week 7: `demos/07-point-and-speak.md`
- [ ] Week 8: `demos/08-mochi-team.md` (fill in its real-microphone checks before posting)
- [ ] Week 9: `demos/09-two-hands.md`
- [ ] Week 10: `demos/10-studio-ui.md`
- [ ] Week 11: `demos/11-precision-and-import.md`
- [ ] Week 12: `demos/12-3d-snapping-and-project-files.md`
- [ ] Bonus: `demos/12b-fist-pan.md` (fist-drag pan; `add-fist-drag-pan`; fill in its real-camera checks before posting)
- [ ] Bonus: `demos/15b-generated-panel.md` ("My AI builds a panel for the job"; `add-generated-panels`; fill in its real-camera checks before posting)
- [ ] Week 14b: `demos/20-hold-to-talk.md` ("Point, hold, speak"; `add-hold-to-talk`; fill in its real-camera checks before posting)

## Change dependencies

Archive in order: each change builds on the capabilities of the ones before it (weeks 1-8 are archived). `add-gesture-tool-palette` adds a requirement to `gesture-recognition`; `add-rhino-connector` adds requirements to `local-access-control` and `scene-tools`. Those base changes must be archived first. `add-two-hand-input` changes `gesture-recognition`, `viewport-navigation`, `tool-palette`, `direct-tools` and `agent-panel`; `add-studio-ui` builds on it and adds `app-settings` and `hand-overlay`. `add-3d-snapping-and-project-files` adds to `drawing-aids`, so `add-precision-aids-and-3dm-import` is archived first. `add-precision-aids-and-3dm-import` builds on `add-studio-ui` (the settings sheet and the feature switches) and adds `drawing-aids` and `model-import` and requirements to `tool-palette` and `scene-model`.
