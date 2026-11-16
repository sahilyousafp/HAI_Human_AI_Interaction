# Proposal

## Why

HAI orchestrates host applications: they model, and HAI is where the user views and edits (`pivot-to-host-orchestration`). After `add-host-adapters` every host's model is drawn in HAI, but the user can only look at it and pick. Move, Rotate and Delete still work only on HAI's own scene, the dominant hand's ring is still full of tools that build walls, slabs and columns in that scene, and the agents still have tools that write it. Asking for a change to something selected in a host works by voice, but nothing on screen shows what is selected or keeps the change to it.

## What Changes

- **Edits on host objects are applied by their host.** A move, a rotation or a delete made in HAI on a mirrored object goes to the host that owns it as a new `host.edit` message. The host applies it as one undo record and answers with `host.edited`; the mirror shows the result.
  - While dragging, HAI shows the objects at their new place at once (a preview of the mirror), so a host edit feels like a scene edit.
  - Undo and Redo follow the order of your own edits, across HAI's scene and the hosts: undoing a host edit sends `host.undo` to that host, redoing it sends a new `host.redo`.
  - A selection spans one host at a time (already so since `add-host-adapters`); a host that cannot edit (its hello says so) refuses the tool with a notice.
- **The rings become an edit ring and a reference ring.**
  - The dominant hand's ring is the **edit ring**: Select, Move, Rotate, Delete, Undo, Redo, Measure and Section.
  - The other hand's ring is the **reference ring**: Line sketch, Area sketch, Marker, Lasso and Ask agent. Zones join it in `add-host-zones`.
  - The creation tools are removed: Wall, Slab, Column, Copy, Massing and the Line tool that built line elements. A saved layout that names one has it taken out; one still equal to the old defaults takes the new ones.
  - Spoken commands follow: "copy", "array" and "scale" are removed; "move", "rotate" and "delete" act on host objects as on scene elements.
- **The agents no longer write HAI's scene.** `create_elements`, `update_elements`, `transform_elements`, `delete_elements`, `group_elements`, `ungroup_elements`, `set_tags`, the five `geometry_*` tools and `context_adopt` are removed from every agent, and their code is deleted with their tests. Agents model only with `host_run` in a host or with the Python workbench. Reading the scene (sketches, markers, references) stays.
- **Ask about a selection.** While objects are selected in a host, a card beside them lists what each one is, as the host describes it: type, layer, area or volume, material and its properties. The card has an **Ask about this** field.
  - A request from the card, or one spoken while the card is open, carries the components (as since `add-host-adapters`) and a limit: only these objects may change.
  - Mochi is told the limit, and a task it hands out for that request takes the selected objects as its scope unless Mochi gives a narrower one. What a run changes outside the scope is reported, as for any claim.
  - When the request's tasks end, the objects they changed stay highlighted until the next selection.
- **Existing projects keep their elements.** Walls, slabs, columns and massings already in a project's scene are still drawn, selected, moved, rotated and deleted by hand, as references. Nothing new of those kinds can be made in HAI.

Out of scope:
- Editing a host object's shape or parameters directly in HAI (a slider for a thickness): that is a request to the agent, which writes code.
- Zones and their badges (`add-host-zones`).
- Attaching a picture to the request. The agent session takes text only; the agent is told to look at the components with its own cameras (`camera_capture`, which frames host objects by id).
- Edits that span two hosts at once.

Demo clip ("Edit anywhere, from HAI", about 45 s): Rhino minimised. Pinch-drag a mirrored canopy 2 m; it moves in HAI at once and Rhino follows. Rotate it by 30 degrees. Undo twice: it goes back, in Rhino too. Tap the canopy: the card says "Closed Polysurface, Roof::Canopy, 32.4 m3, Timber". Type "make it 200 mm thinner" in the card: the agent's run changes only the canopy, which glows when done. Show both rings: no wall, slab or column left. Script: `demos/24-edit-surface.md`.

## Capabilities

### New Capabilities

- `host-edits`: direct edits on host objects applied by their host, their preview, and one undo order across HAI and the hosts.
- `selection-requests`: the selection card for host components and requests limited to them.

### Modified Capabilities

- `tool-palette`: the edit ring and the reference ring replace the action and create tools' defaults.
- `direct-tools`: the creation tools are removed; Move, Rotate and Delete act on host objects.
- `scene-tools`: the scene write tools are removed from the agents.
- `agent-team`: no agent has a tool that writes HAI's scene; a request limited to a selection limits the tasks it hands out.

## Impact

- **`packages/protocol`:** `host.edit`, `host.edited` and `host.redo` messages; `edit` in `HostCapabilities`; `limitTo` in `RequestContext`; the new ring defaults and their migration; the removed tool groups in `HAI_TOOLS`.
- **`apps/bridge`:** relaying edits and their answers (`hosts/host-link.ts`, `server.ts`); the limit in the agent's text (`agent-hub.ts`) and in `delegate` (`team.ts`); removing the scene write tools from `mcp/scene-tools.ts`, `mcp/geometry-tools.ts` and its kernel, `mcp/context-tools.ts` (adopt), `roster.ts`, `approvals.ts`.
- **`apps/web`:** the edit path for host objects in `tools/builtin.ts` and `tools/acted-on.ts`, a mirror preview in `hosts/host-mirror.ts` and `MirrorLayer.tsx`, a shared undo order (`tools/history.ts`, new), the rings, removing `tools/create.ts` and the creation tools, spoken commands (`commands/`), and the selection card (`hosts/ComponentCard.tsx`, new).
- **`plugins/rhino`:** applying `host.edit` (transform and delete by id) in one undo record, and `host.redo`.
- **Docs:** `docs/tools.md`, `docs/gestures.md`, `docs/voice.md`, `docs/hosts.md`, `docs/agent.md`, `docs/agents.md`.
