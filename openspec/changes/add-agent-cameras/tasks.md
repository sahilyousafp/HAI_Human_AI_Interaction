# Tasks

## 1. Protocol and camera table (ends with: an agent can place and list cameras that the user never sees move)

- [x] 1.1 Add `AgentCamera`, `CameraShot` and the extended `view.capture` / `view.captured` messages (agent, cameras, size, options, list of `{camera, png}`) and `Settings.showCameras` (default on) to the protocol; verify with schema tests including old messages without the new fields
- [x] 1.2 Add the per-agent camera table (`AgentEyes`, beside `ViewContext`) (limits: 8 per agent, names up to 32 characters; cleared when the agent's task ends and on project change); verify with unit tests of limits, privacy between agents and clearing
- [x] 1.3 Add `camera_set`, `camera_list`, `camera_delete` (resolving a request in the page with `resolveView`, never sending `view.set`); verify through the MCP client that no `view.set` is broadcast and that another agent sees nothing

## 2. Off-screen shots (ends with: a shot is taken while the user's view and canvas are untouched)

- [x] 2.1 Add the picture renderer in the page: a second `PerspectiveCamera` drawn with the viewer's own renderer in one synchronous step per camera (the user's frame drawn again at its end), asynchronous PNG encoding with the 1280 limit, and a `userOnly` tag for hover, selection, deletion marks, hand pointers, section plane and snap marks; verify with a unit test that each user state is absent from a shot and a screenshot comparison with each state on
- [x] 2.2 Keep the section cut off by default and apply it inside one synchronous render when asked, restoring renderer state; verify with a test that the user's section state is unchanged after both
- [x] 2.3 Add `camera_capture` (one camera, several, presets `iso`, `top`, `front`, `left`, `orbit-sheet`, optionally framed on named elements) with a labelled result; verify each preset's cameras with a unit test and the picture sizes with an e2e
- [x] 2.4 Route a capture to one page (the most recently used), name the agent in the request, keep the 5 s timeout and the "no viewer open" error; verify with two fake viewers that only one renders

## 3. Sun studies and the user's view (ends with: the user's light and camera are never changed by an agent that is checking)

- [x] 3.1 Take sun-study pictures with their own light on an agent-only layer instead of changing the shared light; verify that the user's light is unchanged before, during and after, and that a study's shadows still appear in its pictures
- [x] 3.2 Describe `capture_view` and `set_view` as the user's own view, add the checking guidance to the base instructions and the `cameras` tool group to every agent (instructions version changes); verify with roster and instruction tests
- [x] 3.3 e2e: while the user orbits with the fake input, an agent places two cameras and captures; assert that `nav.current` follows only the user's input, the canvas is not re-rendered for the shot, and two agents can capture at the same time

## 4. Seeing it (ends with: you can tell what each agent looked at)

- [x] 4.1 Carry each agent's last shot (camera name, time, 240-pixel thumbnail) on `team.snapshot`; show it on the agent's chip with the camera's name, click to enlarge; verify with a client unit test and an e2e with screenshots in light and dark
- [x] 4.2 Draw agent cameras as small markers in the agent's colour (not pickable, not in agent shots) and add Settings > Modelling > Show cameras; verify by e2e that markers appear, can be switched off, and do not change picking
- [x] 4.3 Measure and record the budgets (a 1024-pixel shot under 400 ms p90, an orbit-sheet under 3 s, no more than one dropped frame in the user's view during a shot); verify with an e2e that prints the numbers

## 5. Docs and demo

- [x] 5.1 Update `docs/agent.md` (the four tools in the tool table), `docs/agents.md` and `docs/settings.md` (Show cameras); the docs tests must pass
- [x] 5.2 Write `demos/18-agent-eyes.md` ("The agent checks its work": the user keeps orbiting, Architect's cameras and thumbnails appear, a missing column is found and fixed, the user's view never moved) and record the clip; verify on a real run with Claude Code
