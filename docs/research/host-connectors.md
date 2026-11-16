# Driving Rhino, Blender and Revit: MCP servers, code in the host, and Speckle

Research date: 2026-11-16. It informs `openspec/changes/pivot-to-host-orchestration` and the section "HAI orchestrates host applications" in [decisions.md](../decisions.md). Claims that could not be verified are marked.

## The question

The owner asked how good modelling through an MCP server is, compared with modelling directly in Rhino (HAI's plugin runs agent-written Python in RhinoCommon). The same question applies to Blender and Revit.

## Short answer

No head-to-head benchmark of "MCP tool list" against "code inside the host" exists for any of the three. The evidence that does exist points one way:

- Every serious host connector ends up with a run-code tool.
- The CAD research that works is code generation, checked against renders.

So HAI's connectors run approved code in the host as their main way to model. Fixed tools are kept for safe reads, captures and navigation, and pictures go back to the agent so it can check its work.

## General evidence

- **Code beats a fixed tool list.**
  - Anthropic's [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) (Nov 2025): presenting tools as code APIs cut one workflow from 150k to 2k tokens. The cost is that it needs a sandbox or an approval step.
  - [CodeAct](https://arxiv.org/abs/2402.01030) (ICML 2024): across 17 models, Python actions beat JSON or text tool calls by up to 20 points of success, with up to 30 per cent fewer actions.
  - [CAD-Recode](https://arxiv.org/abs/2412.14042) (ICCV 2025): code (CadQuery) works well as a CAD output that other models can read and edit.
- **Pictures in the loop.**
  - [SceneCraft](https://arxiv.org/abs/2403.01248) (Blender code plus a critique of the render): without the visual loop the constraint score fell by 38.4 points. The figure comes from a third-party review, not checked against the paper.
  - [CADCodeVerify](https://arxiv.org/abs/2410.05340) (ICLR 2025): a render-and-check step gave about 5 per cent more successes.
  - [LL3M](https://arxiv.org/abs/2508.08228) uses critic models that look at renders.
  - [BlenderGym](https://arxiv.org/abs/2504.01786) (CVPR 2025): the best vision models still struggle with edits that are easy for people, and splitting effort between generating and verifying helps.
- **Rhino and Grasshopper:** no rigorous benchmark was found. One anecdotal comparison found Python alone the cheapest way to build a wall, and building Grasshopper component by component the most turns (unverified).

## Rhino

| Option | What it can do | Maturity, licence | Security |
|---|---|---|---|
| [mcneel/RhinoAI](https://github.com/mcneel/RhinoAI), official | `run_command`, `run_python`, `run_csharp`, a viewport image, Grasshopper 1 and 2 tools, and an AI panel inside Rhino ([forum](https://discourse.mcneel.com/t/rhino-beta-feature-rhinoai/223146)) | In Rhino BETA, on the Package Manager for Rhino 8 since 2026-09-30. Its developer called it "barebones" in May. MIT | A stdio router plus a local HTTP port. Auth is not documented (unverified) |
| [rhinomcp](https://github.com/jingcheng-chen/rhinomcp) | About 40 geometry tools, viewport capture, Grasshopper tools, Python and C# execution | About 1.2k stars, Rhino 8. MIT | Its README calls it an "unauthenticated TCP loopback link" |
| HAI's plugin | A mirror into HAI, selection both ways, Python in RhinoCommon after approval, one undo record per run | Runs in Rhino 8.36 and 9.0 | The session token, connecting out to the bridge |

Users of RhinoAI ([thread](https://discourse.mcneel.com/t/rhino-mcp-server/216568?page=3)) say:
- `run_command` and the viewport capture are "rock-solid".
- `run_python` and `run_csharp` failed on non-English Rhino.
- `run_csharp` can report success while doing nothing.
- Agents made destructive edits.
- One conversation used half of a Pro plan's daily quota.
- The developer said Claude "rarely" uses commands and mostly writes Python.

**For HAI:** keep the plugin and run code as the main path. From RhinoAI, adopt the ideas of a low-resolution viewport capture and an API-doc lookup.

## Blender

| Option | What it can do | Maturity, licence | Security |
|---|---|---|---|
| [Blender Lab MCP](https://projects.blender.org/lab/blender_mcp), official | 27 tools: `execute_blender_code`, screenshots of areas and windows, viewport renders to a file, scene summaries, API and manual search | v1.0 since about April 2026. Needs Blender 5.1+ (secondary source). Licence unverified | stdio to a TCP socket, no auth documented |
| [blender-mcp](https://github.com/ahujasid/blender-mcp) | `execute_blender_code`, views, asset search and import, generated models through third-party services | Popular. MIT | Its README says the socket "has no authentication or encryption". Telemetry is on by default |
| Bonsai / IFC servers | Bonsai_mcp, show2instruct bonsai-mcp, [MCP4IFC](https://arxiv.org/abs/2511.05533) (50+ BIM tools plus a code tool) | Research or early stage | Unauthenticated local sockets |

**For HAI:** a thin add-on in the same pattern as the Rhino plugin: the mirror, Python after approval, one undo step per run. The official server confirms that the right set is code, screenshots and doc search. Add-ons that import `bpy` are GPL, so HAI's add-on is GPL-3 in its own folder and talks to HAI over a socket.

## Revit

| Option | What it can do | Maturity, licence | Security |
|---|---|---|---|
| Autodesk Revit Public MCP Server ([tools](https://help.autodesk.com/cloudhelp/ENU/ADSKMCP-RevitMcp/files/revitmcp_tools.html)) | 8 read tools (query, element data, select, export views to image or PDF). 3 write tools: edit parameters, move, rotate. 28 experimental ones: sheets, schedules, sections, tags, delete, IFC and gbXML export. **No code execution** | Technology preview for Revit 2027.2 only. Licence unverified | A local stdio program. Auth not documented |
| [mcp-servers-for-revit](https://github.com/mcp-servers-for-revit/mcp-servers-for-revit) | 27 tools, including element creation and `send_code_to_revit` (C#) | Revit 2020 to 2026, early stage. MIT | A plugin over WebSocket. Auth not mentioned |
| [pyRevit Routes](https://pyrevitlabs.notion.site/pyRevit-Routes-HTTP-API-79ef6d4a77b04aca9be6f4e46ffa728e) | An HTTP API inside Revit whose handlers run through `ExternalEvent` | Marked draft. GPL (unverified) | "No authentication mechanism" |

Revit's API runs only on Revit's main thread inside an API context. Outside code has to queue its work through an `ExternalEvent` handler, and every change needs a transaction ([Autodesk](https://help.autodesk.com/cloudhelp/2018/ENU/Revit-API/Revit_API_Developers_Guide/Advanced_Topics/Events.html)).

**For HAI:** an add-in of its own. It runs C# compiled in the add-in (Roslyn) through an `ExternalEvent`, as one `TransactionGroup` per approved run, and exports views as images. Autodesk's read tools can sit beside it on 2027, but their write scope is too narrow to model with.

## Putting an image into a host

| Host | API | Checked |
|---|---|---|
| Rhino | [`ObjectTable.AddPictureFrame`](https://developer.rhino3d.com/api/rhinocommon/rhino.docobjects.tables.objecttable/addpictureframe) | Yes |
| Revit | `ImageType.Create`, then [`ImageInstance.Create`](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-API-MainReference/files/html/0f4cd250-7925-6714-3e08-2bd7c0266252.htm) (2020 and later). The file must be on disk | Yes |
| Blender | `bpy.data.images.load`, then an empty with `empty_display_type = 'IMAGE'` | From the API reference, not run |

## Speckle

- **Licence.** The SDKs (specklepy, `Speckle.Sdk`), `speckle-sharp-connectors`, `speckle-blender` and `@speckle/viewer` are Apache-2.0. `speckle-server` is Apache-2.0 except `modules/workspaces/` and `modules/gatekeeper/`, which have an enterprise licence ([LICENSE](https://github.com/specklesystems/speckle-server/blob/main/LICENSE)).
- **Hosting.** The free plan allows one project, a few users, 100 versions across the workspace and 30 days of history. The version cap is hard ([pricing](https://speckle.systems/pricing/)), and the user count is not settled between sources.
  - The open-source server is meant to run on Linux with a domain and SSL ([deployment](https://docs.speckle.systems/developers/server/deployment-options.md)).
  - The open-source server cannot read the 2026.9 data format, and connectors used with it must stay on 2026.8 or older ([migration](https://docs.speckle.systems/migration/data-model-migration)).
- **Connectors.** [Rhino](https://docs.speckle.systems/connectors/rhino/rhino.md) 7 and 8: Rhino 9 is not yet supported. [Revit](https://docs.speckle.systems/connectors/revit/revit.md) 2023 to 2027: incoming geometry becomes DirectShapes. [Blender](https://docs.speckle.systems/connectors/blender.md) 4.2 to 5.1: basic materials only. No connector carries image textures.
- **Triggering from outside: not possible with the stock connectors.** Send and receive are wired only to each connector's own UI. Grasshopper has token-authenticated publish and load nodes for headless Rhino.Compute ([docs](https://docs.speckle.systems/connectors/grasshopper/grasshopper-developer.md)). The way for HAI is to call the SDKs from its own plugins.
  - .NET: [`Send3`/`Receive3`](https://docs.speckle.systems/developers/sdks/dotnet/concepts/send-and-receive-paths.md).
  - Python: specklepy 2026.9 needs Python 3.11+, so not Rhino 8's Python 3.9.
  - The converters are not published as packages and have to be built from source.
- **Being told about a new version.** The GraphQL subscription `projectVersionsUpdated` ([docs](https://docs.speckle.systems/developers/api/subscriptions.md)). A version exists only after the server has processed it: seconds, not milliseconds (unverified).
- **JavaScript.** There is no official JS SDK for 2026.9 data, and the object loaders return 404 on such versions ([TS docs](https://docs.speckle.systems/developers/sdks/typescript/introduction.md)). `@speckle/viewer` pins its own three.js.
- **MCP servers.** Only community ones, and they only browse metadata ([bimgeek/speckle-mcp](https://github.com/bimgeek/speckle-mcp) and two smaller ones).

**For HAI:**
- The live view stays on each plugin's direct mesh stream to the bridge.
- Speckle carries deliberate hand-offs between hosts, published and loaded by HAI's plugins through the SDKs.
- The bridge uses GraphQL for projects, models and the version subscription.
- The user's own hosted account comes first.

**To verify by spike:**
- `Send3` with the Rhino converters from a plugin, without the connector's UI.
- specklepy inside Blender.
- `Receive3` in a Revit add-in.
- The time from a publish to the subscription event.
- What happens at the version cap.
- Whether projects outside a workspace are still accepted.

## Unverified

- An agent-client panel in RhinoAI.
- RhinoAI's auth and its undo grouping.
- The official Blender MCP's licence.
- The Revit MCP server's licensing.
- The open-source Speckle server on Docker Desktop for Windows at localhost.
