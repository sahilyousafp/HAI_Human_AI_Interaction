# Design

## Context

Facts checked on 2026-10-19:
- RhinoCommon 8.35 on NuGet targets `net48` and `net7.0`; the .NET 9 SDK is installed on the maintainer's machine.
- McNeel's RhinoAI ships as the Yak package "Rhino-MCP-Platform". Its stdio router serves Claude Code, and `MCPConnect` in Rhino prints the setup prompt. Because the agent session loads the user's own MCP servers (`add-claude-agent-bridge`), a RhinoAI server the user has connected to Claude Code is already available to the agent. AEX does not inject or wrap it.

## Goals / Non-Goals

**Goals:**
- Hand navigation in Rhino feels as direct as in the built-in viewer: Rhino redraw latency p90 under 80 ms on the reference laptop.
- The plugin stays small and does only what RhinoAI does not: camera, pointer, picking, selection.

**Non-Goals:**
- Re-implementing agent tools for Rhino (RhinoAI owns that).
- A transparent overlay window over Rhino (later change); feedback is drawn inside Rhino with a display conduit.

## Decisions

**Plugin connects out to the bridge** as a WebSocket client (`System.Net.WebSockets.ClientWebSocket`, present in both `net48` and `net7.0`), rather than Rhino hosting a server. The bridge stays the single hub with one security model, and Rhino needs no open port. Rejected: Rhino-hosted server (a second listener to secure); reusing rhinomcp's TCP socket (different purpose, unauthenticated).

**Discovery without copy-paste.** The bridge also writes `{port, token}` to `%LOCALAPPDATA%\AEX\bridge.json` with a user-only ACL and deletes it on shutdown. `AexConnect` reads it. Connections without an Origin are accepted only with the token and `hello.client = "rhino"`. Browsers always send an Origin, so web pages cannot use this path.

**Threading.** WebSocket receive runs on a background task. Every document or view change is marshalled with `RhinoApp.InvokeOnUiThread`. Camera deltas are coalesced: the latest accumulated delta is applied at most once per Rhino idle tick, so a burst of 30 updates never queues 30 redraws.

**Camera math.** Turntable around world Z, the same as the web controller. Azimuth and elevation deltas rotate the camera location about the target (elevation clamped to 5-89 degrees). Zoom scales the camera-target distance by `exp(delta)`. Pan moves camera and target together in the view plane, scaled by distance. Applied with `RhinoViewport.SetCameraLocations(target, location)`, then `view.Redraw()`. Parallel viewports: pan and zoom only.

**Latency measurement.** Each camera message carries the frame's `captureTs` in epoch milliseconds. After the redraw that applied it, the plugin sends `rhino.redrawn { captureTs, redrawTs }` from `DateTime.UtcNow`. Both clocks are wall-clock on the same machine. The web computes p90 over 3 s.

**Pointer and picking.** The pinch point arrives normalised. The plugin maps it to the active viewport's client rectangle and draws a ring in `DisplayConduit.DrawForeground`. Picking uses `PickContext` with a pick line through the cursor at up to 15 Hz, with a highlight on the hovered object through the conduit (not the document selection). A tap selects via `doc.Objects.Select` after `UnselectAll`.

**Selection sync.** Subscribe to `RhinoDoc.SelectObjects`, `DeselectObjects` and `DeselectAllObjects`; debounce 50 ms; send ids with object type and layer full path.

**Host routing.** `activeHost: "web" | "rhino"` lives in the bridge (shared state) and the web input router sends navigation and pointer messages to the active host only. When Rhino disconnects, the host falls back to the built-in viewer.

**Rhino tools status.** Read from the agent session's `init` event server list. A server whose name or tools match RhinoAI (`rhino`, or tools such as `run_python` under a Rhino server) counts as available. The install steps link to McNeel's Claude Code setup page.

**Build and test.** `plugins/rhino/AEX.Rhino.csproj` (SDK-style, `net48;net7.0`, RhinoCommon `8.*` as a compile-time-only reference). Camera math and message parsing sit in a plain `AEX.Rhino.Core` library with xUnit tests that run in CI without Rhino. Rhino-dependent behaviour is checked by a manual script in `demos/`.

## Risks / Trade-offs

- [Rhino redraw time on heavy models exceeds the latency budget] → Coalescing keeps latency bounded; the HUD shows the measured p90; document "use a lighter display mode while navigating by hand".
- [The plugin cannot be tested in CI without Rhino] → Pure core library with unit tests; integration covered by a fake Rhino client in bridge tests plus the manual demo script.
- [Users install RhinoAI under a different server name] → Detection matches on tool names as well as the server name, and the status links to setup.
