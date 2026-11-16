# Proposal

## Why

HAI now orchestrates host applications: they model with their own tools, and HAI views and edits (`pivot-to-host-orchestration`). But every part of HAI that talks to a host is written for Rhino alone: `ModellingMode`, the `Rhino*` schemas, the eleven `rhino.*` messages, `RhinoLink` in the bridge, `rhino_run_python` and `rhino_get_document`, and the viewer's `rhino/` folder. Adding Blender or Revit on that base would mean a copy of each piece per host. The agent would get a new set of tools per host, and the viewer a new mirror per host. This change makes one contract that any host implements, with Rhino as its first and reference adapter. Blender and Revit then only write their connector.

The agent also needs two things it cannot do in Rhino today:
- Look at the host's own viewport, to check its work, as the research recommends.
- Put a picture into the host as a reference.

## What Changes

- **One host contract** (`packages/protocol/src/host.ts`):
  - A host is `rhino`, `blender` or `revit`.
  - Its hello carries the protocol version and what it can do: the languages it runs, capture, placing images.
  - The `rhino.*` messages become `host.*` messages that carry the host: state, status, objects, selection, select, run, result, undo, run report, open, capture and its answer, place image and its answer.
  - `RhinoObject`, `RhinoBatch` and the other schemas become `HostObject`, `HostBatch` and so on, with object types for all three hosts.
- **The bridge keeps a registry of hosts.**
  - `RhinoLink` becomes a generic `HostLink`, one per connected host. It holds the mirror table, the script queue, what each run did, and the check of a run against the agent's claim.
  - What is Rhino's own, such as reading `# r:` package lines, stays in a small Rhino adapter.
  - Any host connects the way Rhino does today: with the discovery file, the token and no browser origin.
  - A plugin built for the old messages is refused with a clear message to update it.
- **The agent gets one set of tools for every host:**

  | Tool | What it does |
  |---|---|
  | `host_list` | Lists the connected hosts, what each does best, and its status |
  | `host_read` | Reads the document (replaces `rhino_get_document`) |
  | `host_run` | Runs code in the host's language with the user's approval (replaces `rhino_run_python`) |
  | `host_capture` | Returns the host's own viewport image |
  | `host_place_image` | Puts a project image into the host as a picture frame, as one undo step |
  | `host_api` | Looks up the host's API inside the host, by reflection |
| `host_describe` | Describes components by id: properties, quantities, material |

  Projects that always allowed the old tool names keep their choice under the new names.
- **Settings > Hosts replaces Settings > Modelling.** Each host has a switch: use it when it is connected (on by default). An old "Python only" choice turns Rhino's switch off. The Python workbench (`python_run`) is unchanged and works with no host.
- **The viewer draws one mirror layer per host.** A pick names the host and the object. The HUD shows each host's connection, run status and latency. Picking, selection and owner tints work as they do for Rhino today.
- **The user context names the host** of the object under the pointer and of each selected object.
- **Selected components describe themselves.** A host answers `host.describe` for selected objects with what the agent and the user need:
  - name, type, layer or category, bounds
  - quantities (area, volume, length)
  - material
  - the object's own properties: Rhino user strings, Blender custom properties and modifiers, Revit parameters

  The bridge asks for this whenever a host's selection changes (at most 50 objects). The viewer gets it for the selection card, and a request made while something is selected carries it, so the agent knows exactly what "this" is without a call. The agent can also ask with `host_describe`.
- **The Rhino plugin speaks the new contract.** It adds capture (`ViewCapture`, uploaded as an asset), picture frames (`AddPictureFrame`) and API lookup by reflection over RhinoCommon. It also finishes the open tasks of `add-rhino-connector` (archived): CI for the plugin, connect and reconnect, the mirror, selection and their manual checks, Python status, the docs and the demo.

Out of scope:
- Edits made in HAI on host objects, and asking for a change to a selection from its card (`make-hai-the-edit-surface`).
- Zones (`add-host-zones`).
- Sending HAI's own pictures to a host (`add-image-flow`). This change only places an image file that is already in the project.
- Connected MCP servers and the host's installed plugins (`add-capability-connectors`).
- Speckle (`add-speckle-handoffs`).
- The Blender and Revit connectors themselves. They are tested here only through the fake host.

Demo clip ("One contract, any app", about 45 s):
1. Rhino is minimised and HAI shows its model.
2. Ask Architect for a canopy. It calls `host_list`, then `host_run` in Rhino, and the canopy appears in HAI.
3. It calls `host_capture` and compares Rhino's own view with HAI's picture.
4. Ask it to place the site photo in Rhino behind the model.
5. Open Settings > Hosts and show one switch per host.

Script: `demos/23-host-adapters.md`.

## Capabilities

### New Capabilities

- `host-link`: connecting any host to the bridge, the versioned hello and what the host can do, the mirror per host, picking and selection both ways, the host's status, and the user's choice of hosts.
- `host-code`: running code in a host with approval, one undo record and a time limit; reading the document; the host's own viewport image; placing an image; looking up the host's API; describing selected components.

### Modified Capabilities

- `rhino-link`: every requirement moves to `host-link`.
- `rhino-python`: every requirement moves to `host-code`.
- `scene-tools`: the user context names the host of the pointed and selected objects.
- `agent-team`: the host tools go to the agents by role, as the Rhino tools did.

## Impact

- **`packages/protocol`:** `host.ts` (new, replacing `rhino.ts`), `messages.ts` and `agent.ts` (tool groups `host` and `hostRead`, the new tool names).
- **`apps/bridge`:**
  - `hosts/` (new): `host-link.ts`, `registry.ts`, `rhino.ts`.
  - `desktop-link.ts`, renamed from `host-link.ts`.
  - Also changed: `server.ts`, `settings.ts`, `legacy.ts` (old tool names), `mcp/host-tools.ts` (replacing `rhino-tools.ts`), `mcp/scene-tools.ts`, `agent/roster.ts`, `agent/agent-config.ts`, `agent/agent-eyes.ts` and `agent/run-check.ts` (renamed from `rhino-run-check.ts`).
- **`apps/web`:** `hosts/` (replacing `rhino/`: the mirror store, `MirrorLayer`, `HostsSettings`, the view helpers), plus `App.tsx`, `Viewer.tsx`, `agent/agent-client.ts`, and `import/` and `export/` where they read the Rhino state.
- **`plugins/rhino`:** the message models in `HAI.Rhino.Core`, `Session.cs`, and new `Capture.cs`, `PictureFrames.cs` and `ApiLookup.cs`.
- **Tests:**
  - Bridge: the fake Rhino client becomes a fake host, run as both `rhino` and `blender`.
  - e2e: `e2e/rhino.spec.ts` becomes `e2e/hosts.spec.ts`. The visual baselines keep their pictures under new names.
- **Docs:** `docs/rhino.md` becomes `docs/hosts.md`, with a Rhino section. `docs/agents.md`, `docs/tools.md` and `docs/settings.md` are updated.
