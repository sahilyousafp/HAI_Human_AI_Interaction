# Proposal

## Why

Gestures should do more than steer the agent. Many design actions are faster done directly: pick a tool, measure, move a block, cut a section. They need no AI and no waiting. A hand-driven tool palette makes the app useful without a running agent and gives the hands a vocabulary of their own. Agent requests stay for intent-level work ("add three floors").

## What Changes

- A radial tool palette that opens where the hand is, with a long pinch (hold still for 600 ms). The user moves the pinched hand toward a tool and releases to pick it. Releasing in the centre cancels. With practice the direction alone selects, like a marking menu.
- A starter set of direct tools that work on the scene without the agent: Select (default), Move, Measure, Section, Add massing, Delete, Undo, Redo, plus an "Ask agent" slot that opens the agent input.
- An active-tool indicator in the HUD. A closed fist held for 600 ms returns to Select from any tool.
- Tool edits are ordinary undoable scene transactions, labelled with the tool name.
- The palette also opens with the keyboard (hold Space) or a right-button hold, and each tool has a keyboard shortcut.
- A tool registry, so later changes (the Rhino connector, plugins) can add tools to the palette, and users can choose which tools appear and in which slots.

Out of scope: Rhino-side tools (they register later through the registry), sketching or freehand drawing, custom gesture training.

Demo clip (Week 5): "Tools in the palm of your hand". Long-pinch, flick to Measure, measure a facade in mm, flick to Section and slice the building with a hand, flick to Move and shift a massing block, undo, all with no agent involved.

## Capabilities

### New Capabilities

- `tool-palette`: opening, choosing from and configuring the radial palette, the active tool state, and the tool registry.
- `direct-tools`: the behaviour of each built-in tool (select, move, measure, section, add massing, delete, undo, redo, ask agent).

### Modified Capabilities

- `gesture-recognition`: adds a long-pinch hold event. This capability is created by `add-gesture-recognition`, which must be archived before this change.

## Impact

- `packages/perception`: pinch hold detection.
- `packages/protocol`: tool events and palette configuration schema.
- `apps/web`: palette overlay, tool registry, tool implementations, HUD indicator, settings.
- `packages/scene`: no new operations; tools use existing create, update and delete transactions.
- Schedule: inserted after `add-gesture-viewport-navigation` and before `add-claude-agent-bridge`, adding one week to the plan.
