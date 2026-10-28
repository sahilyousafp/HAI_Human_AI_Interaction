# Proposal

## Why

Two gaps left from the spoken commands. With Claude chat off the only way to give a command was the microphone, so a command could not be typed. And "hide" and "isolate" took elements out of the scene itself, so the agents' own pictures of the model (their cameras, used to check their work) left them out too, although the hiding is only a choice about the user's view.

## What Changes

- **A typed command.** With Claude chat off, the bar over the model has a box to type a command in, with or without the voice feature. Enter runs it as though it had been said: on what is selected or pointed at, with the same confirmation for delete, and "Not a command" for anything else.
- **Hidden elements stay in the agents' pictures.** The viewer keeps what the user hid in the scene, invisible and not pickable, and the agents' own pictures show it. The user's view, picking and snapping are as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `voice-input`: typed commands.
- `scene-tools`: the agents' pictures show hidden elements.

## Impact

- `apps/web`: `CommandBar`, the viewer's element meshes, `agent-shot`.
