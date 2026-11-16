# Design

## Context

- Every edit tool works on `Element`s of HAI's `SceneDocument`: Move and Rotate compute `SceneOp`s with `transformOp` and `applySteps`, Delete with `confirmDelete`, all through `ToolContext.apply`. A mirrored host object is not an element; a pick on one returns its id, which `HostMirrors` knows (`apps/web/src/hosts/host-mirror.ts`).
- The bridge already relays page messages to a host (`host.select`, `host.undo`, `host.open`) and the connector already applies each run as one undo record.
- `actedOn` (`tools/acted-on.ts`) widens a picked element to its group or the selection, so a drag on one of several selected moves them all.
- The agent session takes text only (`packages/agent-core`): a request cannot carry an image.
- `Team.delegate` takes an optional `scope`; the run check (`agent/run-check.ts`) reports what a script changed outside its task's scope.

## Goals / Non-Goals

**Goals:**
- A move, a rotation or a delete feels the same on a host object as on a scene element: the same tools, the same gestures, an immediate preview, one undo step.
- One undo order: Undo takes back the user's last edit, wherever it was made.
- Nothing in HAI builds geometry: no creation tool, no agent tool that writes the scene.
- A request about a selection knows what the selection is and changes nothing else without saying so.

**Non-Goals:**
- Shape or parameter edits from HAI; edits spanning hosts; a picture on the request.

## Decisions

**An edit is a transform or a delete, by ids, in millimetres.** `host.edit { host, id, label, op }`, where `op` is `{ op: "transform", ids, matrix }` (a 4 x 4 matrix, row by row, millimetres, Z up, as the mirror's block placements) or `{ op: "delete", ids }`. The host answers `host.edited { host, id, ok, error? }`. A matrix covers moves and rotations about any point, and later mirrors and scales, without a message per kind. Rejected: sending Python for each edit (an approval card for a drag, and the agent's own channel used for the user's hand).

**Edits are not approved.** They are the user's own hand on the model, like a drag in the host's window; the connector applies only a transform or a delete of the ids named, never code. Each is one undo record labelled with the tool ("HAI: Move", "HAI: Rotate 30 deg").

**The edit path in the tools.** `actedOn` returns *targets*: scene elements or host objects, never both (a selection spans one host). For host targets, Move and Rotate compute a matrix from the drag (translate by the offset; rotate by the angle about the plan centre of their box) and call `ctx.applyHost(label, op)`; Delete calls it with a delete after the same confirmation as for elements. Snapping and the drawing aids work as for elements, since a target's box is known. `ToolContext` gains `hostTarget(id)` and `applyHost(...)`; the rest of a tool is unchanged. Rejected: wrapping host objects as fake `Element`s (they would leak into the scene's undo, saving and agent tools).

**The preview is a transform on the mirror.** `HostMirror.preview(ids, matrix)` holds a pending matrix the `MirrorLayer` applies on top of each object's placement. When the edit is sent, the preview stays until the host's batch with those ids arrives, so nothing jumps back for a frame; if the host refuses or does not answer within 5 seconds, the preview is dropped and a notice says why. The budget: the preview follows the hand within one frame, and the host's result is drawn within the mirror's 300 ms p90.

**One undo order, in the page.** `EditHistory` (`tools/history.ts`) records, in order, each edit the user made: a scene transaction or a host edit (with its host). Undo pops the last: a scene entry calls the scene's undo, a host entry sends `host.undo` to its host. Redo does the same with `host.redo`. An agent's run is not in this order: it has its own undo (Undo in the run report). Keyboard and spoken undo use the same order. Rejected: a host undo for every Undo (it would take back an agent's run the user did not mean), or separate Undo buttons per host.

**The rings.** New defaults:
- Edit ring (dominant hand): select, move, rotate, delete, undo, redo, measure, section.
- Reference ring (other hand): sketch-line, sketch-area, place-marker, lasso, ask-agent, then three empty slots.

`migrateRingSettings` takes out removed tool ids from a saved layout (the slot becomes empty) and replaces a layout still equal to any old default. The ring's empty slots are drawn as today.

**The creation tools are deleted.** `tools/create.ts` goes with its tests and the `createTools` feature switch; `massing`, `copy` and the element-building `line` tool go from `builtin.ts`. The Line tool's point editing in Move stays for existing line elements and sketches. Spoken "copy", "array" and "scale" go from the grammar (`commands/grammar.ts`) and the phrase set; "move", "rotate" and "delete" act on host targets through the same path as the tools. Rejected: hiding them behind a feature switch (code that must still be kept working).

**The scene write tools are deleted from the bridge.** The tools listed in the proposal go from `mcp/scene-tools.ts`, `mcp/geometry-tools.ts` (with `geometry/kernel.ts`, its Python and the OpenCascade packages), `mcp/context-tools.ts` (`context_adopt`) and `HAI_TOOLS`. `set_selection`, the read tools, the camera, panel, claim and team tools stay. The scene still accepts the user's own edits and imports. Rejected: keeping the geometry kernel for "references" (it is HAI modelling, which this direction removes; a host does lofts and booleans better).

**The selection card.** `ComponentCard` shows, while a host selection is described, one row per component (up to 8, then "and n more"): its type and name, layer, the largest quantity in m2 or m3, material, and up to three properties. It sits where the scene selection card does (`place-panel.ts`, so it covers no other panel), and follows the same theme and hand-press rules. Its **Ask about this** field sends `agent.send` with `limitTo: { host, ids }`; while the card is open, a spoken request gets the same limit.

**The limit reaches the tasks.** The agent's text gets a `[limit]` line: "change only these objects; anything else needs the user's say". `Team` keeps the limit of the lead's running turn; `delegate` gives a task with no scope the limit's ids as its scope, and narrows a given scope's ids to the limit. The run check then reports what a run changed outside it. When the turn's tasks end, the page highlights the objects their runs changed (from the run results) until the next selection.

**Existing elements.** Elements of removed kinds stay in projects and render as before. They are references: Select, Move, Rotate and Delete work on them; nothing makes new ones.

## Risks / Trade-offs

- [A host edit is slower to land than a scene edit] → The preview holds the result in place until the host's batch arrives; the HUD notices only on a refusal or a timeout.
- [A user expects Undo to take back an agent's run] → The run report keeps its own Undo, and `docs/tools.md` says what Undo covers.
- [Removing the geometry kernel removes a capability for host-less users] → Hosts loft and boolean; the Python workbench still writes geometry with `rhino3dm`. Recorded in `docs/decisions.md`.
- [Saved layouts and voice habits with removed tools] → The migration empties their slots; a spoken removed command says it is gone and what to use.
