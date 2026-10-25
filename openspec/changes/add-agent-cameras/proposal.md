# Proposal

## Why

Agents verify their work by looking at the model, from more than one side. Today they cannot do that without taking the user's eyes. `set_view` animates the user's own camera, and `capture_view` re-renders the user's canvas with the user's camera, so it also shows the user's hover, selection and section state. Neither says which agent asked. With several agents (and, next, workers) working at the same time, they would fight over one camera and keep pulling the view away from the person who is navigating with their hands. Agents need cameras of their own.

## What Changes

- Each agent (and later each worker) gets **private, named cameras**: it places them, lists them, takes pictures through them and deletes them. They are rendered in the viewer page from the same scene, in one step the browser never paints in between, so the user's viewport never moves and what the user sees is the same before and after.
- New tools `camera_set`, `camera_list`, `camera_capture` (one camera, several, or a preset: `iso`, `top`, `front`, `left`, `orbit-sheet`) and `camera_delete`. A shot shows the model as it is (owner tints included) without the user's hover, selection, marks or section, unless the agent asks for them.
- `capture_view` and `set_view` stay, and are described as what they are: the user's own view. `capture_view` is for "what the user sees"; agents are told to use their own cameras for checking work.
- A capture request names the agent and goes to **one** viewer page, not all of them.
- `sun_study` takes its pictures with its own light and no longer changes the user's light.
- The user can see what agents look at: the **last shot of each agent as a thumbnail on its team chip** (click to enlarge), and an optional **camera marker in the agent's colour** in the model. Settings > Modelling gets a switch for the markers.
- An agent's cameras end with its task.

## Capabilities

### New Capabilities
- `agent-cameras`: private named cameras of agents, off-screen shots from them, presets, routing to one viewer, and how the user sees them.

### Modified Capabilities
- `scene-tools`: "Agent can see the view" now distinguishes the user's view from an agent's own cameras, and a sun study no longer changes the user's light.

## Impact

- `packages/protocol`: camera and shot types, `agent` and camera fields on `view.capture`, `team.snapshot` last-shot field, `Settings.showCameras`.
- `apps/bridge`: `ViewContext` (camera table per agent, routing to one page), `scene-tools` (four tools, `sun_study`), `agent-config` and `roster` (tool group and instructions), team snapshot.
- `apps/web`: off-screen renderer next to `attachCapture` in `Viewer.tsx`, `view-link.ts`, thumbnails in `AgentPanel.tsx`, camera markers, `ModellingSettings.tsx`.
- Docs: `docs/agent.md` (tool table), `docs/agents.md`, `docs/settings.md`.

**Out of scope:** video or animated flythroughs; agents moving the user's camera on their own (the user can still ask via `set_view`); shots from Rhino's own viewport; orthographic cameras and per-camera field of view beyond a single optional value.

**Demo clip (45-60 s):** `demos/18-agent-eyes.md` - "The agent checks its work": while the user keeps orbiting with both hands, Architect places an iso and a top camera, its thumbnails appear on its chip, it finds a column missing and fixes it; the user's view never moved.
