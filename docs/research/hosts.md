# AEC host platforms for a gesture + LLM agent UI

Research date: 2026-10-19. Star counts are approximate (GitHub pages or aggregator snapshots).

## 1. Platform comparison

| Platform | Viewport overlay / HUD | External control | MCP ecosystem | User cost | OSS fit | Effort |
|---|---|---|---|---|---|---|
| **Rhino 8 / 9 beta** | Excellent. DisplayConduit `DrawForeground` (Draw2dText, bitmaps). Rhino 9 adds in-viewport UI SDK (GripUserInterfaceObject, screen-space widgets). Eto WebView = WebView2 in Rhino 8+, so a dockable HTML panel works | Plugin opens TCP/HTTP listener. Rhino.Compute REST | Best in AEC: official McNeel MCP (MIT) + rhinomcp (MIT, ~1.2k stars) | $995 perpetual, $195 edu. Compute $0.10/core-hr remote | Plugin can be OSS, users must own Rhino | Medium (C# plugin) |
| **Blender** | Good. `SpaceView3D.draw_handler_add(..., 'WINDOW', 'POST_PIXEL')` with `gpu` module. No embedded browser | Add-on socket server with modal timer | Huge: blender-mcp ~31.6k stars (MIT), Bonsai MCPs for IFC | Free (GPL) | Excellent | Medium. Weak precision-CAD/BIM UX unless Bonsai |
| **Web-native** (three.js / R3F + That Open + replicad / Manifold) | Total control. MediaPipe runs in the same page with no IPC | It is the app. Can be MCP client and server | You build it. Speckle community MCPs only | Free | Best | High (you own modeling ops) but lowest user friction |
| **Revit 2027** | Hard. DirectContext3D only, clumsy. No real 2D HUD API | Official Revit Public MCP (tech preview, mostly read + bulk param edits), pyRevit Routes | Official preview + several community servers | ~$3k/yr subscription (unverified) | Poor | High |
| **FreeCAD** | Coin3D scene graph, Qt overlays | Python macros / sockets | neka-nat/freecad-mcp ~0.9k stars, MIT | Free (LGPL) | Good | Medium, dated UI |
| **SketchUp** | Ruby `Tool#draw`, HtmlDialog | Ruby TCP extension | mhyrr/sketchup-mcp ~100 stars | Subscription | Fair | Medium |
| **Archicad** | Limited | JSON API (port 19723), Tapir add-on | Official Archicad MCP (Beta) in 2026 portfolio + community servers | Subscription | Fair | Medium-high |
| **Unreal 5.8 / Unity 6 / Godot** | Full UI control (UMG / uGUI / Control) | Unreal 5.8 experimental embedded HTTP MCP at `127.0.0.1:8000/mcp`. Unity AI Assistant built-in MCP (beta) | CoplayDev/unity-mcp ~13.5k stars, Coding-Solo/godot-mcp ~4k stars | Unreal free below revenue threshold, Godot free | Godot best | High, not CAD |

**Transparent always-on-top window over Rhino on Windows:** yes. Electron `transparent: true` + `alwaysOnTop` + `setIgnoreMouseEvents(true, {forward: true})` (WPF/WinUI/Tauri can do layered click-through too). Caveats: needs DWM composition, the window cannot be resized, and anchoring graphics to 3D geometry needs a small Rhino plugin that streams the window position and view matrix. Robust split: 3D-anchored feedback via DisplayConduit inside Rhino, camera/HUD chrome in the overlay window. Not verified against Rhino 9's Direct3D viewport.

## 2. Rhino details

- Rhino 8: new ScriptEditor with CPython 3 (likely 3.9) and C#. Rhino 9 (beta, open to Rhino 8 owners): CPython 3.13, .NET 10, Direct3D display on Windows, Grasshopper 2, Rhino.Compute on Linux, in-viewport UI SDK. Ship date unconfirmed; 8.33 (2026-07-07) is current stable.
- WebView2 panel works in Rhino 8+ via `Eto.Forms.WebView` in a registered panel. JS to Rhino via custom URI navigation interception in `DocumentLoading` + `ExecuteScript`. Forum reports of crashes in WebView-only dialogs and "WebView2 not found" cases. Pure Python panel hosting is awkward, so use C#.
- MediaPipe inside Rhino's CPython: possible but wheel compatibility and UI-thread blocking make it a bad idea. Run tracking out of process.
- DisplayConduit HUD 2D elements tile in a grid during scaled (>1) viewport captures.
- **Official McNeel MCP:** [mcneel/RhinoAI](https://github.com/mcneel/RhinoAI) (MIT, ~370 stars, active `rhino-9.x` branch, announced 2026-05-07, distributed via Yak, works on Rhino 8 and 9). `MCPStart` opens an HTTP MCP port in Rhino, a stdio router serves Claude Desktop / Claude Code. Tools: `run_python`, `run_csharp`, document, selection, view/capture, GH1/GH2. Includes an in-Rhino AI Panel (`AIPanel`) hosting Claude, Codex or Gemini over ACP / stream-json. PLAN.md (2026-06-01): one undo per agent turn, GH2 authoring with self-correction. Self-described as "barebones". Docs: [mcneel.github.io/RhinoAI](https://mcneel.github.io/RhinoAI/).
- **Community MCP:** [jingcheng-chen/rhinomcp](https://github.com/jingcheng-chen/rhinomcp) (MIT, ~1.2k stars, last push ~March 2026). Python MCP server to C# plugin over TCP `127.0.0.1:1999`. Geometry ops, layers, viewport capture, Grasshopper graph building, Python/C# exec. Unauthenticated on loopback.
- **Rhino.Compute:** free on your own desktop for a single licensed user. Remote/multi-user $0.10/core-hour.
- **rhino3dm:** [mcneel/rhino3dm](https://github.com/mcneel/rhino3dm) (MIT, ~765 stars). Read/write .3dm in JS/WASM, Python, .NET. Lets a web app round-trip Rhino files without Rhino.

## 3. Blender

- [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) (MIT, ~31.6k stars). Socket port 9876, `execute_blender_code`, viewport capture, asset sources.
- IFC via Bonsai: [Show2Instruct/ifc-bonsai-mcp](https://github.com/Show2Instruct/ifc-bonsai-mcp), JotaDeRodriguez/Bonsai_mcp. Bonsai is GPL-3, IfcOpenShell LGPL-3 (from memory).
- Overlay via `gpu` + `gpu_extras` in POST_PIXEL handlers (`bgl` removed).
- Best free host, but foreign interaction model for architects and mesh-first rather than NURBS.

## 4. Web-native stack

- three.js / R3F (MIT). [ThatOpen/engine_components](https://github.com/ThatOpen/engine_components) (MIT, ~714 stars), web-ifc (MPL-2.0). Old IFC.js / web-ifc-viewer is deprecated and AGPL.
- xeokit: AGPL-3 or commercial. Avoid for an embeddable OSS project.
- [Speckle](https://github.com/specklesystems/speckle-server) (Apache-2.0). No first-party Speckle MCP found; community bimgeek/speckle-mcp (v0.1, Mar 2026). Connectors for Rhino, Revit, Archicad, SketchUp make it the natural interchange bus.
- Geometry kernels (licences from memory, verify): replicad (MIT, OpenCascade.js BREP), OpenCascade.js (LGPL-2.1, 10-30 MB WASM), Manifold (Apache-2.0, robust mesh CSG), JSCAD (MIT).
- Browser advantages: `@mediapipe/tasks-vision` hand/face/holistic with GPU delegate in the same page, zero install, zero IPC latency, browser handles camera permission. Wrap later in Electron/Tauri for local `claude` subprocess and overlay mode.

## 5. Autodesk and others

- **Revit 2027:** Autodesk Assistant + Revit Public MCP Server (tech previews). Official server reads models and does bulk parameter edits; "Trusted-Write"/"Experimental" variants mentioned, scope unclear. Community: mcp-servers-for-revit mono-repo, shuotao/REVIT_MCP_study (WebSocket 8964), Demolinator/revit-mcp-server (pyRevit Routes, 48 tools), Bimwright.Rvt.Server, Nonica (freemium).
- **APS viewer:** good for web display of Autodesk models but needs cloud accounts and has a cost model.
- **Archicad:** official MCP (Beta). Community: Boti-Ormandi/archicad-mcp (Tapir + JSON API, 173 commands), lgradisar, 3d-mcp.
- **FreeCAD:** [neka-nat/freecad-mcp](https://github.com/neka-nat/freecad-mcp) (MIT). Viable fully-OSS backend; BIM workbench UX rough.
- **SketchUp:** mhyrr/sketchup-mcp (`eval_ruby` over TCP).
- **Unreal:** official experimental MCP in 5.8. **Unity:** [CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp) + official AI Assistant MCP.

## 6. Prior art

- Gesture CAD: Firefly / Primate for Grasshopper (Leap Motion, Kinect, ~2015, dead). [GestureCAD](https://github.com/Sarthak180403/gestureCAD) (MediaPipe, view-only). Blender: BlendArMocap (unmaintained), IronHands (demo). Web: collidingScopes "3D Model Playground" (three.js + MediaPipe + Web Speech).
- **Gap:** no maintained webcam-gesture + LLM-agent CAD/BIM tool found.
- Research: [JustShape](https://dl.acm.org/doi/10.1145/3772318.3790641) (ACM 2026, co-speech gesture + multimodal LLM for parametric modeling on HoloLens 2, closest match). [CGGI-CM](https://www.tandfonline.com/doi/full/10.1080/10447318.2025.2560516) (IJHCI 2025, gesture + gaze CAD). neuralCAD-Edit, LLM4CAD-Editor (2026).
- Spatial: Shapr3D on Vision Pro (hand + eye, full editing still wants keyboard/trackpad). Gravity Sketch, Arkio.
- Text/AI to CAD: [CADmium](https://github.com/chandar-lab/CADmium), Text2CAD (NeurIPS 2024), [CAD-Recode](https://github.com/filaPro/cad-recode) (likely NC), Zoo.dev Design Studio + Zookeeper agent + Zoo MCP.

## 7. Recommendation: hybrid

- Not Rhino-only: ties users to a $995 licence and Windows C#, MediaPipe needs a separate process anyway, and McNeel's RhinoAI already covers "LLM panel in Rhino".
- Not a from-scratch modeler: months rebuilding NURBS, booleans, IFC.
- Build: web app (Vite + React/R3F) owning camera, MediaPipe, gestures, HUD, agent UX; Electron/Tauri wrapper for local CLI subprocess and overlay mode. Two-tier control (gestures = deterministic nav/select/confirm, LLM = intent-level edits via MCP, face = attention + nod/shake). Backend adapters: built-in web geometry (free default), Rhino (RhinoAI / rhinomcp + thin C# plugin for view matrix, selection, DisplayConduit ghosts), later Blender/Bonsai, Revit, Archicad; Speckle as optional bus. Licence MIT or Apache-2.0, avoid AGPL deps.

## Unverified

Rhino 9 ship date; Revit MCP write scope; Speckle viewer licence; replicad / OCC.js / Manifold / CAD-Recode licences; MediaPipe fps on target laptop; overlay over Rhino 9 Direct3D.
