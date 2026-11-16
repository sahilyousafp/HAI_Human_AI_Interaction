# Demo 23 - "One contract, any app"

> The bridge side of each step is covered by tests with a stand-in for the connector (`apps/bridge/src/hosts/host-link.test.ts`, `apps/bridge/src/mcp/host-tools.test.ts`, `e2e/hosts.spec.ts`). The steps in Rhino itself (capture, the picture frame, the description, the API lookup) are checked by the list at the end, in Rhino 8 and Rhino 9, before posting.

Target length about 45 s, 16:9, captions burned in. Rhino stays minimised the whole time: everything is seen in HAI.

## Setup (before recording)

1. Install the new plugin (`docs/hosts.md`, Rhino, Connecting). Open `tower.3dm` in Rhino, run `HaiConnect`, then minimise Rhino. The top bar shows **Rhino connected** with its latency.
2. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme, Claude Code signed in. Put a site photo in the project as `.hai/images/site.jpg`.
3. Show my hands on; camera started and engaged.
4. Recorder at 1080p, 30 fps, capturing the browser window only.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-6 s | Orbit the tower by hand. Point at the top bar: **Rhino connected 46 ms**. | "Rhino is minimised. Its model lives here." |
| 2 | 6-18 s | Say "Architect, a timber canopy over the entrance." Allow the script on the card (it names Rhino). The canopy appears in HAI. | "The agent writes the code in Rhino, I approve it, Rhino builds it." |
| 3 | 18-26 s | Tap the canopy. Say "make this 200 mm thinner." The chat shows the canopy's volume and material in the request. | "When I select something, the agent knows exactly what it is." |
| 4 | 26-34 s | The agent captures Rhino's top view (`host_capture`); the picture shows in its tool chip beside HAI's own. | "It checks its work against what Rhino itself draws." |
| 5 | 34-40 s | Say "put the site photo behind the tower, facing south." The photo appears in HAI's view as a picture frame. | "Pictures go into Rhino too." |
| 6 | 40-45 s | Open Settings > Hosts: Rhino on and connected, Blender and Revit waiting with how to connect them. | "One contract: Blender and Revit are next." |

## Checks in a real Rhino (8.36 and 9.0), before posting

Each is a task of `openspec/changes/add-host-adapters/tasks.md`; tick it there once seen.

- [ ] Connect, bridge not running, bridge restart (reconnects within 5 s), and an old plugin refused with the message to update (5.3).
- [ ] A new object appears, a moved one follows, a deleted one goes, with Rhino minimised; a tap selects in Rhino; a mouse selection in Rhino shows in HAI. Record the p90 (5.4).
- [ ] `host_capture` of the active view and of the top view, at 1280 x 720, in Rhino 8 and in Rhino 9's Direct3D display; record the time; the viewport is back where it was afterwards (5.5).
- [ ] `host_place_image`: the frame is centred, upright, embedded, and one Undo removes it. `host_api` for `Brep.CreateFromLoft` answers in under 300 ms once indexed (5.6).
- [ ] A closed Brep, an open surface and a block are described with the right type, volume or area, material and user strings (5.7).
