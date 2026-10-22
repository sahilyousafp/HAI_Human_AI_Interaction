# Plan: gesture + agent interaction layer for AEC

Decided 2026-10-19, updated the same day with the gesture tool palette, and on 2026-10-21 with the agent team, two-hand input and hand modelling tools. Research notes: `docs/research/`. Interactive decision page: `docs/decision/index.html`. Every milestone is specified as an OpenSpec change under `openspec/changes/`.

## Decision

**Hybrid.** Build our own interaction-layer app (camera, gestures, tool palette, HUD, agent loop), not our own modeler. Browser-first, Electron wrapper later. Rhino is the first external host, for modelling and drafting: the agent works through Python (a managed environment with any library, and Python inside the open Rhino), and a thin C# plugin adds camera sync, pointing, selection, the Python runner and turn review. Blender/Bonsai comes later.

Why:
- The novel part is the interaction layer. No maintained webcam-gesture + LLM-agent CAD/BIM tool exists.
- MediaPipe runs best in the browser on Windows (GPU delegate); Python GPU is Linux-only.
- A Rhino-only plugin limits reach to Rhino owners and competes with McNeel's own RhinoAI panel (the original reason for a separate app; the agent's Python capability layer does not need Rhino at all).
- A from-scratch modeler means months rebuilding NURBS, booleans and IFC.

## Architecture

```
apps/web (Vite + React + R3F)       camera -> perception -> gestures -> palette, tools, navigation, HUD, viewer
apps/bridge (Node)                  WebSocket hub, scene store, agent process, MCP scene tools, approvals
apps/overlay (Electron, later)      transparent click-through HUD over Rhino
packages/protocol                   shared zod schemas for every cross-process message
packages/perception                 MediaPipe worker, One Euro filter, gesture state machines
packages/scene                      architectural scene model, transactions, undo
packages/agent-core                 AgentProvider: ClaudeCli now; Codex, ACP, local models later
plugins/rhino (C#)                  camera, pointer, selection, Python runner, turn grouping
```

Three speeds of control:
- **Gestures and head pose:** navigation, pointing, selection, confirm/reject. Local, no LLM, under 50 ms.
- **Tool palette:** long pinch opens a radial menu of direct tools (move, measure, section, add massing, delete, undo). No LLM.
- **Voice + agent:** intent-level edits through MCP tools, reviewed per turn (nod to keep, shake to revert).

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
| 15 | `add-agent-turn-review` | The agent proposes, I nod | One undo per agent turn, in Rhino too |
| 16 | providers (to specify) | Same task, three models | The AgentProvider interface |
| 17 | overlay (to specify) | HUD floating over Rhino | Click-through windows on Windows |
| 18 | custom gestures (to specify) | Training my own gestures | Landmarks to LiteRT.js |
| 19 | release v0.1 (to specify) | Launch reel | Lessons + how to contribute |

Weeks 1-8 are built and their changes archived (`openspec/specs/` holds the current specs); weeks 9, 10, 11 and 12 are built and wait for their clips. Weeks 14 and 16-19 get their OpenSpec changes once the weeks before them have taught us what they need. After v0.1: Blender/Bonsai IFC connector, coarse gaze (WebEyeTrack), dynamic gestures, a small user study.

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

## Change dependencies

Archive in order: each change builds on the capabilities of the ones before it (weeks 1-8 are archived). `add-gesture-tool-palette` adds a requirement to `gesture-recognition`; `add-rhino-connector` adds requirements to `local-access-control` and `scene-tools`. Those base changes must be archived first. `add-two-hand-input` changes `gesture-recognition`, `viewport-navigation`, `tool-palette`, `direct-tools` and `agent-panel`; `add-studio-ui` builds on it and adds `app-settings` and `hand-overlay`. `add-3d-snapping-and-project-files` adds to `drawing-aids`, so `add-precision-aids-and-3dm-import` is archived first. `add-precision-aids-and-3dm-import` builds on `add-studio-ui` (the settings sheet and the feature switches) and adds `drawing-aids` and `model-import` and requirements to `tool-palette` and `scene-model`.
