# Tasks

## 1. Bridge side

- [ ] 1.1 Add Rhino protocol messages (hello client "rhino", camera delta, pointer, pick result, selection, redrawn) in `packages/protocol`; verify schema unit tests
- [ ] 1.2 Accept token-only connections without Origin for `client: "rhino"` and write the user-profile discovery file with a user-only ACL; verify "Rhino plugin connects", "token-less local client rejected" and "discovery file lifecycle"
- [ ] 1.3 Add `activeHost` shared state, routing of navigation and pointer messages, and fallback to the web host on disconnect; verify with a fake Rhino client in bridge tests
- [ ] 1.4 Mirror Rhino selection into the bridge and include Rhino pointed object and selection in `get_user_context`; verify "mouse selection mirrored" (fake client) and "'this' in Rhino"

## 2. Plugin core (no Rhino needed)

- [ ] 2.1 Create `plugins/rhino` with `AEX.Rhino.Core` (camera math, message models) and xUnit tests; verify turntable orbit, clamp, zoom and pan tests pass with `dotnet test`
- [ ] 2.2 Add the plugin project (`net48;net7.0`, RhinoCommon 8.x compile-time reference) with `AexConnect` and `AexDisconnect`; verify it builds for both targets
- [ ] 2.3 Add the C# job to CI on windows-latest (`dotnet test` for the core library, build for the plugin); verify it runs green

## 3. Plugin behaviour (manual in Rhino)

- [ ] 3.1 Implement connect, discovery, reconnect within 5 s and the command-line messages; verify "connect", "bridge not running" and "bridge restart" by the manual script
- [ ] 3.2 Apply coalesced camera deltas on the UI thread and send redraw acks; verify "orbit in Rhino" and that the HUD shows the Rhino latency p90
- [ ] 3.3 Draw the cursor ring and hover highlight with a display conduit, pick at up to 15 Hz and select on tap; verify "tap selects a Rhino object"
- [ ] 3.4 Send selection changes debounced at 50 ms; verify selection appears in the HUD within 200 ms

## 4. Web side

- [ ] 4.1 Add the host switch and Rhino connection status; verify "switch to Rhino" E2E with the fake Rhino client
- [ ] 4.2 Add Rhino agent tools status with install steps; verify "RhinoAI missing" with an init-event fixture without a Rhino server

## 5. Docs

- [ ] 5.1 Write `docs/rhino.md` (install the plugin, `AexConnect`, RhinoAI setup, performance tips); verify the steps on a clean Rhino 8 profile

## 6. Demo

- [ ] 6.1 Write `demos/11-rhino.md` (connect, orbit and zoom by hand, point and tap-select, ask the agent to array the selection, record Rhino latency p90) and record the clip; verify on the maintainer's Rhino 8
