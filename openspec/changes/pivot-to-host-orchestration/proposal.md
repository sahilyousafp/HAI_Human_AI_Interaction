# Proposal

## Why

HAI was built as a modelling environment with hosts on the side. Agents write walls, slabs and columns into HAI's own scene, the dominant hand's ring creates geometry, and Rhino is one optional host. But Rhino, Revit and Blender already model, document and render better than an agent building geometry one MCP call at a time. They have decades of tools that HAI would only be copying, badly. For end-to-end design, the agent's job is to direct those applications, not to replace them. HAI's job is to be the one place where the person sees all of it and steers it, with hands, face and voice.

The research behind this change is in `docs/research/host-connectors.md`. It found three things:

- An agent writing code inside the host does better than one calling a fixed tool list. Every official host MCP server ends up exposing a run-code tool for this reason.
- A loop where the agent looks at pictures of its own work improves CAD results, and HAI already renders such pictures.
- Speckle can carry models between the hosts, but it is too slow for a live view.

## What Changes

- **The Claude agent becomes an orchestrator.** Mochi breaks a request into tasks, each for one host application, and sequences the hand-offs between them. Specialists drive the hosts by writing code in them (RhinoCommon, `bpy`, the Revit API), each run approved by the user and one undo record in the host.
- **Hosts model, HAI views and edits.**
  - Each host streams a live mirror of its model into HAI's viewer.
  - The user selects, moves, rotates, deletes and undoes host objects in HAI. Each such edit is applied by the host that owns the object.
  - The host windows can stay minimised.
- **HAI sends hosts images.** The agent can place a picture in a host, either a capture from HAI or one the user dropped in. It can also ask a host for its own viewport image, to check its work.
- **Zones.** While a host models, its zone in HAI's view updates live and carries the host's icon and the agent's state, the way approval badges and owner boxes show today.
- **Speckle is the bus between hosts.** HAI's plugins publish and load through the Speckle SDKs, so a hand-off needs no clicks in a connector. Speckle is never the view.
- **HAI's own scene becomes a sketch and review layer.** Lines, areas, markers, named views and imported references stay. Agents lose `create_elements`, `update_elements`, `transform_elements` and `delete_elements`, and the creation tools (wall, slab, column, copy, massing, line as geometry) leave the rings.
- **Other plugins and MCP servers add capabilities.** The user can connect more modelling power beside HAI's own connectors:
  - MCP servers, such as RhinoAI's Grasshopper tools, blender-mcp's asset and generation tools, Autodesk's Revit MCP read tools and Ladybug Tools MCP.
  - The host's own plugins, such as Grasshopper add-ons, Blender add-ons and Revit add-ins.

  Each connected server is offered to the agents that work on its host. Each host reports which of its own plugins are installed, so the agent can use them through `host_run`. The tools stay behind the usual approvals.
- **Generated panels reach further.**
  - A panel can read web information through the bridge, from sites the user allowed on the panel's offer card. The panel itself still has no network.
  - A panel can show sourced images: openly licensed search results with their attribution, HAI's captures, and pictures the user dropped in. It can hand any of them to a host.
  - A panel is fully usable by hand: press, drag, scroll and hover inside it, and grab its header to move or resize it.
- **One host contract.** The `rhino.*` messages and the Rhino link become `host.*` and a host registry. Rhino is the first adapter, Blender the second and Revit the third.

This change records the direction and its reasons and updates the plan and the docs. The work itself comes in the changes that follow, in this order:

1. `add-host-adapters`
2. `make-hai-the-edit-surface`
3. `add-host-zones`
4. `add-image-flow`
5. `add-capability-connectors`
6. `extend-generated-panels`
7. `add-blender-connector`
8. `add-speckle-handoffs`
9. `add-revit-connector`
10. `reshape-agent-team-as-orchestrator`

Out of scope:
- **Other MCP servers:** requiring any of them, or wrapping one in place of HAI's own connector. They add to a connector and never replace it.
- **Panels:** giving a panel direct network access. Every web read goes through the bridge, to the sites the user allowed.
- **Speckle:** self-hosting the server (it cannot read the current data format yet), and Speckle as the live view.
- **Other hosts:** Archicad, SketchUp and FreeCAD, which come later through the same contract.
- **Vendor logos** in the UI: hosts are shown with generic glyphs and their names.

Demo clip ("My AI stopped modelling and started directing"): a short talk to camera over the decision page and the research table. It says why code in the host beats a tool list, why Rhino, Blender and Revit do the modelling, and what HAI keeps (the view, the hands, the edits). It ends on the order of the next changes. Script: `demos/22-orchestration.md`.

## Capabilities

### New Capabilities

- `host-orchestration`: covers four things.
  - The principle that hosts model and HAI views and edits.
  - The host contract every connector implements.
  - Speckle as the only bus between hosts.
  - HAI's scene as a sketch and review layer.
  - Connecting other plugins and MCP servers as extra capabilities.
  - Panels that can read the web through the bridge, show sourced images and be worked by hand.

### Modified Capabilities

None in this change. The changes listed above modify `scene-tools`, `tool-palette`, `direct-tools`, `agent-team` and `rhino-link` one at a time.

## Impact

- **Docs:** `docs/PLAN.md` (decision and architecture), `docs/decisions.md` (a new section), `docs/research/host-connectors.md` (new), `README.md` (pitch and roadmap), `docs/handoff.md` (open work) and `openspec/config.yaml` (project context).
- `openspec/changes/add-rhino-connector`: its open plugin tasks move into `add-host-adapters`, under the new message names.
- **Privacy:** Speckle is hosted, so a hand-off sends the user's model to the user's own Speckle account. This is a second, opt-in exception to "everything stays on 127.0.0.1", next to open data. It is off until the user signs in to Speckle.
- **Privacy, panels:** a panel's web reads are a third opt-in exception. They are allowed per panel, to the sites the user saw on the offer card. A request carries what the panel asks for, never the user's model.
- **Licensing:** the Blender add-on uses `bpy` and so is GPL-3. It will live in its own folder with its own licence and talk to HAI only over a socket, so HAI stays Apache-2.0. The licence check must allow that one folder.
