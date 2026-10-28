# Proposal

## Why

Selecting something did nothing on its own: Move, Copy and Delete each wanted their own drag or tap, and there was no way to say "copy this 4 times 6 m along y" or "copy and rotate 90". A transcript was only handled locally when it was exactly a tool's name; everything else went to the agent, which is slow and costs a request for something a grammar can do. There was also no way to use HAI without Claude: the chat could not be switched off and have only commands left.

## What Changes

- **A local command grammar** for what a person says to the selection: move, copy (once or as a line of copies), rotate, scale, mirror, select (all, a type, a level, none), delete, hide, isolate and show all.
  - Distances take mm, cm and m, in digits or words; directions are x, y, z, east, west, north, south, up and down.
  - Commands chain with "and", "then" or a comma, each step on what the one before left. A chain is one undo step named after what was said.
  - It acts on "this" (what the hand pointed at while speaking), else the selection; with neither it says so.
  - All or nothing: a transcript the grammar does not fully understand goes to the agent unchanged.
  - Delete asks first (a nod or Enter); hide and isolate change only what is drawn, picked and snapped to here.
- **Rotation and scale on elements.** Massing and columns can be turned (`rotationDeg`, about their centre) and imported models turned and scaled (`rotationDeg`, `scale`). Bounds, snapping, the viewer, the Rhino export and the simulation geometry honour them. Walls, slabs and lines turn and scale through their points.
- **One transform module** (`transformPatch`, `applySteps`) that Move, Copy, the spoken commands and the agent all use.
- **`transform_elements` for the agent**: move, turn, scale, mirror or copy N times (a linear array), in one change.
- **Claude chat off.** The Agent feature is renamed Claude chat. Off: no chat panel, no agent session, listening for names is off, a transcript that is not a command shows "Not a command" and goes nowhere, and a small microphone strip over the model takes the chat's place.
- Fixes two races found on the way: the asset upload left a temporary file when it failed before its stream had opened the file, and the sign-in test read its marker file before the shell had written to it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `voice-input`: spoken commands, and what happens to a transcript that is not one when Claude chat is off.
- `scene-model`: `rotationDeg` and `scale`.
- `scene-tools`: `transform_elements`.
- `agent-panel`: the chat is absent when Claude chat is off.

## Impact

- `packages/protocol`: `rotationDeg` and `scale` in `scene.ts`; the tool group in `agent.ts`; the feature's label in `features.ts`.
- `packages/scene`: `placement.ts`, `transform.ts`; bounds, snapping and extrusions read the new fields.
- `apps/web`: `commands/` (grammar, planner, runner), the visibility store, the `command` hook in voice input, `CommandBar`, geometry and viewer placement, the Rhino export.
- `apps/bridge`: `transform_elements`, the simulation geometry, the agent's prompt, the upload cleanup.
- Not changed: the OpenCascade kernel for array along a curve, loft and sweep (the next change).
