# Proposal

## Why

Rhino is where precise design happens, and it is the user's daily tool. The same hands that orbit the built-in viewer should orbit Rhino's viewport, point at Rhino objects, and let the agent act on them. McNeel's RhinoAI already gives the agent Rhino tools; what is missing is the fast, direct link between the user's body and Rhino's viewport.

## What Changes

- A small Rhino 8 plugin (`AEX for Rhino`) that connects to the local bridge with one command, `AexConnect`, and reconnects automatically. No token copying is needed.
- Gesture navigation drives Rhino's active viewport (orbit, zoom, pan) when Rhino is the active host, with gesture-to-redraw latency measured and shown.
- The hand pointer appears in Rhino's viewport as a cursor ring. The object under it is highlighted, and a pinch tap selects it in Rhino.
- Rhino's selection is mirrored to the bridge, so the agent and the HUD know what is selected in Rhino.
- A host switch in the HUD: built-in viewer or Rhino.
- Rhino agent tools: AEX detects whether the RhinoAI MCP server is loaded in the user's Claude session. If it is missing, the HUD explains how to install the Rhino-MCP-Platform package and connect it. The agent's user context includes Rhino's pointed object and selection, so "this" works in Rhino too.

Out of scope: reviewing agent changes in Rhino with ghosts and one-step reject (next change), palette tools that run Rhino commands (later, through the tool registry), Rhino 9 and macOS (later), packaging on Yak (later).

Demo clip (Week 13): "The same gestures now drive Rhino 8": orbit and zoom a Rhino model by hand, point at a surface, tap to select it in Rhino, then ask the agent to "array this 5 times along X".

## Capabilities

### New Capabilities

- `rhino-link`: connecting Rhino to the bridge, viewport navigation, pointer and picking, selection sync, host switching and Rhino agent-tool status.

### Modified Capabilities

- `local-access-control`: adds token-only connections for local non-browser clients such as the Rhino plugin (created by `add-claude-agent-bridge`).
- `scene-tools`: the user context includes Rhino's pointed object and selection when Rhino is the active host (created by `add-claude-agent-bridge`).

## Impact

- New `plugins/rhino`: C# RhinoCommon plugin (`net48;net7.0`, RhinoCommon 8.x from NuGet), not linked against any McNeel source beyond the public SDK.
- `apps/bridge`: Rhino client role, discovery file in the user profile, camera and pointer relay, selection mirroring.
- `apps/web`: host switch, Rhino status, routing of navigation and pointer to Rhino.
- `packages/protocol`: Rhino messages (hello with client "rhino", camera delta, pointer, pick result, selection, redraw ack).
- Requires Rhino 8 on Windows. RhinoAI (Rhino-MCP-Platform) is recommended for agent tools but not required for navigation.
