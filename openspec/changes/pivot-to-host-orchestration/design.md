# Design

## Context

Facts checked on 2026-11-16. The sources are in `docs/research/host-connectors.md`.

- **HAI's own Rhino plugin** already runs in Rhino 8.36 and 9.0. It mirrors the document's meshes, blocks and selection into HAI's viewer and runs approved Python as one undo record.
- **The bridge has no host abstraction.** Everything is Rhino-named: `ModellingMode`, the `Rhino*` schemas, the `rhino.*` messages and `RhinoLink`. `apps/bridge/src/host-link.ts` is the link to the Electron app, not to a CAD host.
- **Every geometry edit in the viewer** passes through one hook, `ToolContext.apply(label, ops)` (`apps/web/src/tools/types.ts`).
- **The agents' cameras** (`apps/bridge/src/agent/agent-eyes.ts`) render pictures of the model as PNG in the bridge. Nothing sends them to a host yet.
- **Owner boxes and approval badges** already show agents on the model: `ClaimBoxes` in `viewer/owner-display.tsx` and the drei `<Html>` pins in `viewer/ApprovalBadges.tsx`.

## Goals / Non-Goals

**Goals:**
- One place to look: every host's model is visible and editable in HAI's viewer, and the host windows are optional.
- Hosts do the modelling, each with its own kernel and tools.
- The agent writes code in the host, and the user sees each script and approves it before it runs.
- One contract that a new host implements, so the agent and the viewer know nothing host-specific beyond a tool description.

**Non-Goals:**
- Making HAI a modeller again. No new geometry kernels or creation tools.
- A Speckle-based live view, or HAI's own exchange format.
- Sandboxing host code. As with Python today, the approval card is the control.

## Decisions

**Code in the host, not a fixed tool list.** Each connector offers the same small set of tools:

| Tool | What it does |
|---|---|
| `host_list` | Lists the hosts that are connected |
| `host_read` | Reads the document |
| `host_run` | Runs code in the host's own language |
| `host_capture` | Returns the host's own viewport image |
| `host_place_image` | Puts a picture in the host |
| `host_doc_lookup` | Looks up the host's API |

The reasons:
- CodeAct measured code actions up to 20 points more successful than JSON tool calls.
- RhinoAI's developer reports that Claude mostly writes Python, and rarely uses the server's commands, when it has both.
- Fixed tool lists are a ceiling, and each one is another thing to maintain per host.

Rejected:
- Routing through each vendor's or the community's MCP server. None has an approval gate or one undo per run. Revit's official server cannot run code at all and only edits parameters, moves and rotates. The community servers listen on unauthenticated sockets.

**HAI's own plugin per host.** Each plugin is thin. It mirrors meshes to the bridge, applies edits and runs code. It also captures the viewport, places images and calls the Speckle SDK. Each connects out to the bridge with the discovery file and the session token, as the Rhino plugin does, so no host opens a port. Rejected: one generic socket per host as the community servers use (unauthenticated, with no mirror).

**HAI is the view and the edit surface.**
- *Direct edits.* The user's move, rotate, delete and undo on a mirrored object become a `host.edit` message to the host that owns it. The host applies the edit as one undo record, and the mirror shows the result. `ToolContext.apply` routes each operation: one on a sketch element goes to HAI's scene, one on a host object goes to its host.
- *Anything else goes to the agent.* An edit that needs the host's own tools ("make this 300 thick", "fillet this edge") is a request, and the agent writes code for it.
- Rejected: editing inside the host windows, because the user would leave HAI's view, and the hands and gestures work only there.

**Asking about a selection.** The pattern is a selected area of an artifact: point at the part, say what should change, and only that part changes.
- *The card.* The selection card lists each selected component as its host describes it (`host.describe`, from `add-host-adapters`), and adds an "Ask about this" field. A request from it, or one spoken while the selection holds, carries the components, a close-up picture of them from `agent-eyes`, and a task scope of their ids.
- *The limit.* The bridge checks every run against that scope (`run-check.ts`). What a run changed outside it is reported on the card with the way to undo it.
- *The result.* When the task ends, its changed, added and deleted components are highlighted until the next selection.
- It lives in `make-hai-the-edit-surface`.

**Zones.** A zone is a `TaskScope.region` claimed for a task on a host.
- *How a zone starts.* The user draws one with the zone tool on the reference ring, or the orchestrator picks one.
- *What it shows.* Its box reuses `ClaimBoxes`. A floating badge reuses the `ApprovalBadges` pin and shows the host's glyph, the agent's face and its state: modelling, waiting for approval, done or handed off. The objects inside update live from the host's mirror stream (100 ms coalescing, 300 ms p90 budget).
- *How it gets its final look.* The visual design goes to the owner as options in an Artifact before it is built.

**Speckle carries hand-offs, never the view.** Publishing a version takes seconds. The free plan allows 100 versions. No JavaScript loader reads the current (2026.9) data. The live view therefore stays on each plugin's direct mesh stream, and Speckle is used only for deliberate hand-offs from one host to another.
- *Triggering.* The stock connectors send and receive only from their own UI, so HAI's plugins call the SDKs directly: `Send3`/`Receive3` in .NET for Rhino and Revit, and specklepy for Blender.
- *The bridge's part.* It uses Speckle's GraphQL API only: projects, models, and the subscription that announces a new version.
- *Hosting.* The user's own hosted Speckle account comes first. Self-hosting waits until the open-source server reads the current format.
- *Rejected:* files on disk as the bus (the owner chose Speckle); HAI's own exchange format (Speckle's converters already preserve BIM data, blocks and materials).

**HAI's scene is a sketch and review layer.**
- *Removed:* the agents' scene write tools, and the creation tools in `apps/web/src/tools/create.ts`, along with their tests. They are deleted, not hidden: a hidden tool still has to be maintained.
- *Kept:* sketches, markers, named views and imported references, which are how the user tells the agent "here" and "like this".
- *New rings:* the dominant hand's ring becomes an edit ring (select, move, rotate, delete, undo, measure, section, ask-agent). The other hand keeps the reference ring, with the zone tool added.

**Other plugins and MCP servers add to a connector, never replace it.** HAI's own connector stays the one path for the mirror, the edits, the approvals and the one undo per run. On top of it:
- *MCP servers.* The Extensions tab already adds project MCP servers (`claude mcp add --scope project`). A new catalogue suggests known servers per host: RhinoAI (Grasshopper 1 and 2), blender-mcp (assets and generated models), Autodesk's Revit MCP (read and export on 2027), Ladybug Tools MCP and Speckle's community servers. Each entry has its licence, what it adds and its security note (several listen on unauthenticated sockets).
- *Who gets a server.* A server the user connects is tagged with the hosts it serves. Each agent gets its tools for the hosts of its task. Today Claude Code hides any tool an agent's `tools:` line does not list, so the bridge adds them to the agent's definition (`--agents`), as it already does for its own tools.
- *Host plugins.* Each connector reports the host's installed plugins and add-ons in its hello: Rhino's plugin list and Grasshopper's component libraries, Blender's enabled add-ons, Revit's add-ins. `host_run`'s description lists them, so the agent can use Ladybug, Kangaroo or Bonsai through code.
- *Approvals.* Every tool of a connected server goes through the tool approval card like any other MCP tool.
- Rejected: a server in place of HAI's connector (no mirror, approval or undo); installing servers without the user (each one runs someone else's code).

**Panels reach the web through the bridge, and the panel itself stays offline.**
- *Web reads.* A panel asks with `hai.web.get(url)`. The bridge fetches over HTTPS from the sites listed on the panel's offer card, which the user accepted with the offer. It returns text, JSON or an image of at most 2 MB, with a limit of 30 requests a minute.
- *The offer.* `offer_panel` takes the list of sites, and the card shows them. A request to any other site is refused and the panel is told.
- *What stays the same.* The frame's policy (`connect-src 'none'`) and the sandbox do not change.
- Rejected: opening the frame's policy to the network, because the agent's code would then talk to any server and the bridge could not see or limit it.

**Sourced images.** A panel or an agent can search for images (`hai.images.search`, the `image_search` tool).
- *Sources.* Openverse and Wikimedia Commons, both openly licensed, each result carrying its licence, author and source link. Other sites only through the panel's allowed list.
- *Where they go.* Chosen images are saved in `.hai/images/` with their attribution, can be dropped into HAI's scene as a reference, and can be sent to a host with `host_place_image`.
- *Rejected:* generic web image search (licences unknown).

**Panels worked by hand.** `frame-runtime.ts` already turns a hand press into a click or a slider move inside the frame. This extends it:
- Pinch and move becomes a drag (pointer down, move and up, so a canvas, a map or a list can be dragged). Pinch and move outside any draggable element scrolls.
- The hand pointer's place sends hover.
- The app's own header is a grab handle: pinch it to move the panel, pinch both corners with two hands to resize it.

The pointer snaps to the panel's controls the way it snaps to the app's buttons. Gesture navigation never waits on the panel, and the frame gets hand events at most 60 a second.

**Hosts by strength.** The orchestrator's instructions and each `host_run` description say what the host does best:
- Rhino for form, NURBS and fabrication geometry.
- Revit for BIM elements, levels, schedules and sheets.
- Blender for visualisation, materials, lighting and mesh work.

**Order: Rhino, then Blender, then Revit.** Rhino's plugin exists and becomes the reference adapter. Blender is free and scripted in Python, so it is the cheapest second host to prove the contract on. Revit has the hardest API: a single API thread, `ExternalEvent`, transactions and C# compiled in the add-in.

## Risks / Trade-offs

- [A host edit from HAI feels slower than editing HAI's own scene] → Show the edit at once as a preview in HAI, then replace it with the mirrored result. The budget is the mirror's: 300 ms p90.
- [Speckle needs an account and the internet] → Hand-offs are the only feature that needs it, and they say so. Everything else works offline. A self-hosted server is the way out once the open-source one reads the current format.
- [Speckle's free plan stops at 100 versions] → Publish on hand-off only, never per edit. Show the number of versions left.
- [Speckle loads geometry into Revit as DirectShapes, not native elements] → The Revit specialist rebuilds native elements with code where that matters, and the zone badge says which objects are DirectShapes.
- [Three plugins in three languages to maintain] → Each keeps a pure core library that is unit-tested without the host, and shares the one message contract and the mesh asset contract test.
- [A connected MCP server does something destructive, or listens on an open socket] → Its tools go through the approval card. The catalogue states each server's security note. Servers are added only by the user.
- [A panel's web reads leak what the user is working on] → A panel reaches only the sites shown on its offer card, the bridge logs every request with its site, and a request carries only what the panel's code put in it. The card says so.
- [Users who relied on modelling in HAI without any host] → The Python workbench (`python_run` writing `.3dm`) stays as the host-less way to make geometry, and the result is imported as a reference.
