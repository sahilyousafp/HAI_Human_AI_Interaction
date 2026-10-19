# Plan: gesture + agent interaction layer for AEC

Decided 2026-10-19, updated the same day with the gesture tool palette. Research notes: `docs/research/`. Interactive decision page: `docs/decision/index.html`. Every milestone is specified as an OpenSpec change under `openspec/changes/`.

## Decision

**Hybrid.** Build our own interaction-layer app (camera, gestures, tool palette, HUD, agent loop), not our own modeler. Browser-first, Electron wrapper later. Rhino is the first external host: the agent reaches it through McNeel's RhinoAI MCP, and a thin C# plugin adds camera sync, pointing, selection and turn review. Blender/Bonsai comes later.

Why:
- The novel part is the interaction layer. No maintained webcam-gesture + LLM-agent CAD/BIM tool exists.
- MediaPipe runs best in the browser on Windows (GPU delegate); Python GPU is Linux-only.
- A Rhino-only plugin limits reach to Rhino owners and competes with McNeel's own RhinoAI panel.
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
plugins/rhino (C#)                  camera, pointer, selection, turn grouping; agent tools come from RhinoAI
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
| 8 | `add-rhino-connector` | Same gestures drive Rhino 8 | What I reused from RhinoAI vs wrote |
| 9 | `add-agent-turn-review` | The agent proposes, I nod | One undo per agent turn, in Rhino too |
| 10 | providers (to specify) | Same task, three models | The AgentProvider interface |
| 11 | overlay (to specify) | HUD floating over Rhino | Click-through windows on Windows |
| 12 | custom gestures (to specify) | Training my own gestures | Landmarks to LiteRT.js |
| 13 | release v0.1 (to specify) | Launch reel | Lessons + how to contribute |

Weeks 10-13 get their OpenSpec changes once weeks 1-9 have taught us what they need. After v0.1: Blender/Bonsai IFC connector, coarse gaze (WebEyeTrack), dynamic gestures, a small user study.

## Change dependencies

Archive in order: each change builds on the capabilities of the ones before it. `add-gesture-tool-palette` adds a requirement to `gesture-recognition`; `add-rhino-connector` adds requirements to `local-access-control` and `scene-tools`. Those base changes must be archived first.
