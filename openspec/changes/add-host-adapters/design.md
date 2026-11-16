# Design

## Context

- **The Rhino link works and is Rhino-named throughout.** It runs in Rhino 8.36 and 9.0 (`docs/decisions.md`, 2026-11-04), and it mirrors blocks. The names are listed in the proposal. A run already reports what it added, changed and deleted (`RhinoRunChanges`), and the bridge checks that against the agent's claim (`agent/rhino-run-check.ts`).
- **Plugins already upload binary assets.** The Rhino plugin uploads its meshes to the asset store (`/assets`, token required) before it names them in a batch. That is the way for any binary a host sends, captures included.
- **`apps/bridge/src/host-link.ts` is the link to the Electron app that started the bridge**, not to a CAD host. The name is freed by renaming it.
- **Tool approvals** are kept per project by tool name (`mcp__hai__rhino_run_python`). `legacy.ts` already moves saved names once, for the AEX to HAI rename.

## Goals / Non-Goals

**Goals:**
- Adding a host needs a connector and a short description of what it does best, and nothing else in the bridge, the viewer or the agent's tools.
- No behaviour of the Rhino link gets worse. It keeps its 300 ms p90 mirror, its 500 ms overhead for a trivial run, its approvals and its one undo per run.
- The agent can see what the host sees, and can put a reference picture in it.

**Non-Goals:**
- Edits from HAI, zones, Speckle, connected MCP servers. Each has its own change.
- More than one connection per host. A second Rhino replaces the first, as today.

## Decisions

**One schema module, `host.ts`.** It holds the following:
- `HostId = z.enum(["rhino", "blender", "revit"])`.
- `HostObjectType`: Rhino's six types, plus `object` for a Blender object and `element` for a Revit element.
- `HostObject`, `HostNotDrawn`, `HostSync`, `HostBatch`, `HostSelected`, `HostChange` and `HostRunChanges`, with the same fields as their Rhino forms. The fields were already generic: id, name, layer (a Blender collection path or a Revit category), colour, bounds, asset, transform and tags.
- `HostRunResult`, which adds `language`.
- `HostCapabilities = { languages: ("python" | "csharp")[], capture: boolean, placeImage: boolean, apiLookup: boolean }`.

`rhino.ts` is deleted, not aliased, because a compatibility layer is code to maintain. `ViewRequest` and `VIEW_MODES` move to `view.ts`, since they are about HAI's camera.

**Messages carry the host.**

| Message | Fields |
|---|---|
| `host.state` | `{ host, connected, app, document, run, capabilities, objects, notDrawn, sync, selection }`, one message per host |
| `host.status` | `{ host, run, document }` |
| `host.objects` | `{ host, ...HostBatch }` |
| `host.selection` | `{ host, objects }` |
| `host.select` | `{ host, ids }` |
| `host.run` | `{ host, id, language, code, timeoutMs, agent, title, part, claim }` |
| `host.result` | `{ host, ...HostRunResult }` |
| `host.undo` | `{ host }` |
| `host.run.report` | `{ host, ... }` |
| `host.open` | `{ host, path }` |
| `host.capture` / `host.captured` | `{ host, id, view?, width, height }` / `{ host, id, ok, asset?, error? }` |
| `host.image.place` / `host.image.placed` | `{ host, id, path, plane, widthMm, heightMm, agent, title }` / `{ host, id, ok, objectId?, error? }` |
| `host.api` / `host.api.result` | `{ host, id, query }` / `{ host, id, entries, truncated }` |

- `app` is the host's name and version, and `run` replaces Rhino's Python status: `ready` or `unavailable` with a reason.
- On connect, the bridge greets a page with one `host.state` per host it knows. That includes a disconnected host the user has switched on, so the HUD can say "Blender not connected".
- Rejected: one message type per host. The page and the bridge would branch on the host everywhere.

**A versioned hello.**
- A host says `hello { client: <HostId>, protocolVersion: 2, app, connectorVersion, run, document, capabilities }`. `PROTOCOL_VERSION` goes from 1 to 2 for every client, pages included, since they are served by the same bridge.
- A host hello with an older `protocolVersion` is the old plugin (`olderHostHello` in `envelope.ts` reads it loosely). The bridge answers `host.refused { reason: "This HAI for Rhino is older than the bridge: install the new one" }`. The plugin prints that on Rhino's command line and does not reconnect.
- Token-only connections without an Origin are accepted for any `HostId`, as they are for `rhino` today.
- Rejected: accepting both versions. The plugin and the bridge ship together in one installer, and two protocols double the tests.

**The bridge: a generic link, a registry and a small adapter per host.**
- `hosts/host-link.ts` is today's `RhinoLink` with the host taken out:
  - the mirror table and its snapshot for late pages
  - clearing the table on disconnect
  - the one-at-a-time script queue with its grace period
  - `RunMeta`
  - the run report built by `run-check.ts`
- `hosts/registry.ts` holds one link per `HostId`. When the set of hosts in use changes, it tells the agent hub, which restarts the sessions, as `availabilityChanged` does today.
- `hosts/rhino.ts` is the adapter. It holds:
  - the description of what Rhino does best and of its language: Python 3, RhinoCommon, `rhinoscriptsyntax`, `# r:` lines
  - the parser that reads packages from a script for the approval card
  - Rhino's own text in the run tool's answer
- An adapter is a plain object `{ id, label, strengths, languages, packagesOf(code), runHint }`. Blender and Revit add one file each.
- Rejected: a class hierarchy per host. The differences are data and one function.

**Tools take the host as an argument.**
- `host_run { host, code, title, timeoutMs }`: the language is the host's own (Rhino: Python; Revit: C#). A host with more than one language takes `language`.
- `host_read { host }` returns the units, layers or collections, counts by type, the selection and the active view.
- `host_capture { host, view?, width?, height? }` returns the host's viewport as an MCP image. `view` takes HAI's named views. Without one, the host's active view is captured.
- `host_place_image { host, path, origin, normal, widthMm }`: the path is in the project, and `.hai/images/` is where `add-image-flow` will put pictures. It is one undo record and is checked against the claim like a run. It needs no approval card because it runs no code. It is offered only to agents that change the model.
- `host_api { host, query }` lists the matching types and members with their signatures, at most 50, found by reflection inside the host. Nothing is downloaded, and the result is exactly the version the user runs.
- `host_list` names each host, its strengths, whether it is connected and switched on, and its run status.
- Each tool's description lists the hosts in use and their strengths, so it is rebuilt when the set changes.
- **Approvals.** `host_run` asks as `rhino_run_python` did, with the whole script and its packages. A project's "always allow" is per host, because allowing Python in Rhino should not allow C# in Revit. The approval key is `host_run:<host>`.
- **Migration.** `legacy.ts` moves saved approvals once: `mcp__hai__rhino_run_python` becomes `host_run:rhino` and `mcp__hai__rhino_get_document` becomes `mcp__hai__host_read`. An agent file whose `tools:` line names an old tool gets the new one, because the bridge takes the app's tools from the role (`--agents`) and ignores old names.
- Rejected: one set of tools per host. That means six more tools per host, and the agent's prompt grows with each host.

**Tools by role**, as today. `HAI_TOOLS.host` (`host_run`, `host_place_image`) goes to agents that change the model, and `HAI_TOOLS.hostRead` (`host_list`, `host_read`, `host_capture`, `host_api`, `host_describe`) goes to every agent. The host tools are offered only while at least one host is switched on, and then only for the hosts in use.

**Selected components describe themselves.**
- *The message.* `host.describe { host, id, ids }` is answered by `host.described { host, id, components }`, at most 50 per request. Each `HostComponent` is `{ id, name, type, layer, bounds, quantities, material, properties }`:
  - `quantities` holds whichever of `areaMm2`, `volumeMm3` and `lengthMm` apply.
  - `properties` holds at most 100 entries of a string, number or boolean, each value at most 200 characters.
- *What each host fills in.*
  - Rhino: user strings, the material name, and `AreaMassProperties` and `VolumeMassProperties` for closed Breps and meshes, skipped above 10 ms per object and marked so.
  - Blender: custom properties, modifiers, the material, mesh area and volume.
  - Revit: instance and type parameters, with their units.
- *When it is sent.*
  - The bridge asks whenever a host's selection changes, 150 ms after the last change, and keeps the answer with the selection.
  - The viewer gets it in `host.selection` for the selection card.
  - A request made while something is selected carries the components in its context (`RequestContext.components`, at most 50, cut to 20 000 characters in the agent's prompt), so the agent knows what "this" is without a call.
- *The tool.* `host_describe { host, ids }` describes any objects, read-only, for every agent.
- *The budget.* 300 ms for 50 selected objects, measured by the bridge.
- Rejected: describing every object in the mirror batch, which multiplies the stream for detail the user rarely looks at.

**Captures travel as assets.** The plugin renders with `ViewCapture` at the asked size (at most 1280 px on the long side) and uploads the PNG to the asset store, as it does meshes. It answers with the asset id, and the bridge reads the asset and returns it to the agent. The asset is dropped after 10 minutes. The budget is 1.5 s from request to answer for 1280 x 720 on the reference laptop, measured by the bridge and shown in the tool chip. Rejected: base64 in the WebSocket message. Large frames block the socket for the mirror.

**Placing an image.** Rhino uses `ObjectTable.AddPictureFrame(plane, path, asMesh: false, width, height, selfIllumination: true, embedBitmap: true)`, so the document keeps the picture if the project moves. It is one undo record labelled `HAI: <agent>: <title>`. The bridge resolves the path against the project folder and refuses one outside it.

**API lookup by reflection.** The Rhino plugin searches the public types and members of `RhinoCommon` and `Rhino.UI` loaded in the running Rhino. A query matches names, case-insensitively, and dotted paths such as `Brep.CreateFromLoft`. The plugin returns signatures and XML summaries where the assembly ships them. The budget is 300 ms. The results are cached for the session.

**The viewer.**
- `apps/web/src/hosts/host-mirror.ts` is `RhinoMirror`, keyed by host. `MirrorLayer` takes a host and is drawn once per host in use.
- A pick returns `{ host, id }`, and `host.select` goes to that host only, after clearing the other hosts' selections.
- The HUD has one chip per switched-on host, showing its glyph, its name, connected or not, and its p90 when connected. The glyphs are generic shapes, not vendor logos, and go to the owner as options in an Artifact before they are final.
- Settings > Hosts lists each host with its switch, its status and how to connect it. Owner tints and "Show cameras" move there from Settings > Modelling.

**Settings.** `settings.json` gains `hosts: { rhino: boolean, blender: boolean, revit: boolean }`, all true by default. A stored `modelling: "python"` becomes `rhino: false`, and any other value becomes `rhino: true`. `modelling` is then dropped. The mode in use is gone: the workbench is always there, and the host tools exist only for hosts in use.

**The Rhino plugin.** The message models move to `HAI.Rhino.Core/Protocol.cs`, with `host: "rhino"` on every message and the versioned hello. `Capture.cs`, `PictureFrames.cs` and `ApiLookup.cs` are new. The C# contract test for mesh assets stays, and a second one checks that C# serialises each message the way the zod schemas parse it: fixtures written by C# are parsed in `packages/protocol` tests.

## Risks / Trade-offs

- [The rename breaks the plugin in the owner's Rhino until it is rebuilt] → The bridge refuses the old plugin with a message that says what to do. `docs/hosts.md` and the release notes say so. Both ship in one installer.
- [A wide rename touches many files and specs at once] → Done in task order behind passing tests: protocol, bridge, tools, web, plugin. The e2e specs for the mirror, parallel work and project files run before each merge.
- [Saved approvals or agent files with old tool names] → A one-time migration in `legacy.ts` with its own unit test, and the role grants take precedence over agent files.
- [`ViewCapture` differs between Rhino 8 and Rhino 9's Direct3D display] → The manual script captures in both. On failure the error comes back to the agent, and HAI's own `camera_capture` still works.
- [Reflection over RhinoCommon is slow on the first query] → The index is built once on a background thread after connect, and a query before it is ready waits at most 300 ms, then answers with what is indexed.
