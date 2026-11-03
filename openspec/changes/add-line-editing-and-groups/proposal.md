# Proposal

## Why

The owner tried drawing and selecting by hand and reported four things that do not work.

- A pinch is not one point. A pinch that drifts orbits the view and places nothing, the point moves while the fingers close, and the line jumps between snaps and angles.
- A line cannot be put right. Undo during a line changes the model instead, a finished line is too thin to pick, its points cannot be moved or removed, and sketches have no undo.
- The selection is not respected. Only Move carries it, there is no Rotate by hand, and a pointer resting on one part of a selection while speaking narrows a command to that part.
- Nothing holds a set of elements together. An import falls apart into its objects, and an agent can turn each element about its own centre and scatter them.

## What Changes

- **One pinch, one point.** With Line, a hand's pinch places the point the preview shows. The preview stands still while the fingers close, drifting while they are closed moves nothing, and the view does not orbit. The hand that started the line steers it, and the other hand's drag orbits. A long pinch that stays still still talks or opens a ring, and places nothing.
- **A hand's jitter does not flip a snap or an angle.** A snap a hand has is kept until the pointer is 36 px from it (it is taken within 24). An Ortho angle is kept until the pointer is clearly nearer the next step, and right beside the anchor it does not swing at all. The mouse is exact and unaffected.
- **Line locks to angles by default.** Ortho for Line is its own drawing aid, on until the user turns it off. Wall keeps the shared Ortho, off by default.
- **Undo inside a tool.** Undo and Redo, however they are asked for, go to the active tool first: Line takes back or restores its last point, and a sketch tool its last sketch. Line's panel gets Undo point and Finish, which a hand can press.
- **A line can be edited after it is placed.** A finished line can be picked within a finger's reach on screen. Its points show as handles: Move drags one through the drawing aids, and Delete removes one.
- **One Line tool, Straight or Freeform.** A toggle in the panel at the right of the view. Freeform draws with a drag, without Grid or Ortho, and makes a real model line. Sketch line stays as the agent's note.
- **Groups.** A group is a system tag, `hai.group`, on each member. Tapping a member selects all of them. An import arrives as one group. Groups do not nest, and an element belongs to one.
- **Every tool acts on the whole selection.** Move, Copy, Delete and a new Rotate tool carry the selection and whole groups as one undo step. A copied group gets its own id.
- **An options panel pinned to the selection**, with Ungroup one press away.
- **Agents keep groups together.** A request about several elements groups them first as one undo step, and the agent is told the group's id. `transform_elements` takes whole groups, and `update_elements` refuses to turn or move one member.
- **Voice respects the selection.** Pointing at part of a selection while speaking means the whole selection.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `direct-tools`: one pinch one point, jitter, Line's angle lock, undo inside a tool, point editing, Freeform, the whole selection, Rotate, the options panel.
- `scene-model`: groups.
- `scene-tools`: group tools for agents, and transforms that keep groups whole.
- `multimodal-intent`: what "this" means when part of a selection is pointed at.
- `agent-session`: a request about several elements groups them and names the group.

## Impact

`apps/web/src/tools`, `apps/web/src/viewer`, `apps/web/src/scene`, `apps/web/src/import`, `apps/web/src/voice`, `apps/web/src/commands`, `packages/scene`, `packages/protocol`, `apps/bridge/src/mcp` and `apps/bridge/src/agent`. No change to the scene file's format: a group is a tag.
