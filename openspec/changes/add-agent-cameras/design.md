# Design

## Context

What exists (read in the code):

- `set_view` broadcasts `view.set` to every page; the page animates the user's own navigation state `nav.current` (`Viewer.tsx`, `view.onViewRequest`). It gives way to the user's own input.
- `capture_view` broadcasts `view.capture` to every page, the first `view.captured` wins (`apps/bridge/src/agent/view-context.ts`). The page answers through `view.attachCapture`: `gl.render(scene, camera)` with the user's camera into the user's canvas, then a PNG (`canvasToPng`, longest side 1280). The message carries no agent.
- `sun_study` calls the same capture with a `SunSetting`; the page moves the one shared directional light and keeps it until a tool ends or Escape. The user's light changes too.
- The canvas is `frameloop="demand"` with `preserveDrawingBuffer: true`. Section clipping is set on materials and the renderer (`SectionClipping`), owner tint and selection and hover are baked in the element materials (`ElementMesh`).
- Reusable: `resolveView` (pure: a view and a request give a view), `Turntable`, `cameraPosition`, `frameBox`, `between`.

## Goals / Non-Goals

**Goals:** agents get views of their own that never touch the user's; several agents can look at the same time; the user can see what they look at; pictures match what the user's model looks like (tint, materials) minus the user's transient state.

**Non-Goals:** animation, orthographic or per-camera lenses beyond one default, Rhino's viewport, agents steering the user's camera for their own checking.

## Decisions

**Render in the page, with the viewer's own renderer, not in the bridge.** The page owns the scene, the meshes, the materials and the Rhino mirror. A bridge renderer would need a second GL stack and a copy of the geometry. For each camera the page does one synchronous step: put the user's state aside, draw the scene from a second `THREE.PerspectiveCamera` with the viewer's renderer, copy the canvas into a scaled image, put the state back and draw the user's frame again. The browser cannot paint in between, so the user's canvas, camera and selection are the same before and after and nothing flashes; the step costs about two frames. Encoding to PNG and JPEG is asynchronous (the browser does it off the main thread), and between cameras the browser is free, so the user's own frames keep coming while a set of eight is taken. Because it is the viewer's own renderer, a picture has the same tone mapping, antialiasing and shadows as the user's view. Rejected: a `WebGLRenderTarget` (no tone mapping there, so pictures would not look like the model on screen); a second renderer (duplicates every GPU buffer); drawing the user's canvas and restoring it across a paint (a visible flash).

**The user's transient state is put aside for the step, not copied.** Whatever is only the user's is tagged in the scene (`userData.userOnly` on the section plane, measuring marks, snap marker, claim boxes, camera markers and a tool's draft, `userData.cleanColor` on every element and mirrored object mesh for its colour without hover, selection and deletion mark, `userData.grid` on the infinite grid). The step hides the tagged objects, swaps in the clean colours and clears hover glow, turns off the renderer's clipping unless the agent asked for the section, centres the infinite grid under the picture's own camera (it follows the user's camera from frame to frame, which leaked the user's position into pictures), and puts all of it back in a `finally`. The scene's `onAfterRender` hook (latency stamps, picking) is switched off for the step. Rejected: cloning the scene per shot (cost and memory on dense models).

**Camera table per agent, in the bridge.** `AgentEyes` keeps `Map<agent, Map<name, AgentCamera>>` and each agent's last picture. A camera is `{name, azimuth, elevation, distance, target}` in the same units as `ViewCamera`. `camera_set` is resolved in the bridge with `resolveView` (moved into `@hai/scene` with the turntable maths so the bridge and the viewer share it), using the scene's element bounds and the mirrored Rhino objects' bounds for `frame`. A camera is dropped when its agent's task ends and all of them when the project changes; a camera never survives a restart. Names are at most 32 characters, at most 8 cameras per agent.

**Presets are camera sets, framed on the model or on named elements.** `iso` is four cameras at 45, 135, 225 and 315 degrees, 35 degrees up; `top` straight down (elevation 89, the viewer's limit); `front` from the south and `left` from the west, 10 degrees up; `orbit-sheet` eight cameras at 45-degree steps. Each picture is labelled with its direction in the tool result's text. A preset never places anything in the camera table; the agent places a camera itself when it wants to keep one.

**A capture names the agent and goes to one page.** `view.capture` gains `agent`, `cameras` (explicit camera values, resolved by the bridge from its table), `size` and `options` (`section`, `selection`). `ViewContext` tracks which page the user last used (`context.update` and any input message mark a page active) and sends the request only there; when none is marked it uses the first. The 5-second timeout stays. Pictures return in one `view.captured` with a list of `{camera, png}`. Rejected: keep broadcasting and take the first answer (every open window does the render work, and a hidden window may answer with a stale canvas).

**Sun studies get their own light.** The shot render gets its own `DirectionalLight` for the study, added to the scene on a layer only agent cameras see and removed after the render; the user's `SunLight` is not touched, and `view.setSun` is no longer called for studies. The user's own sun-study tool is unaffected (it stays shared state, because there the user is looking).

**Seeing it.** `team.snapshot` carries, per agent, `shots: {agent, camera, at, thumb}` where `thumb` is a 240-pixel JPEG data URL made in the page before it replies (a PNG for the agent, a small thumbnail for the strip), and `cameras` for the markers. The chip strip shows the thumbnail with the camera's name; a click opens the full picture, which the page that took it keeps in memory (the bridge stores nothing), in a dialog over the whole page. An agent's last picture stays after its task ends, until it takes another or the project changes. Markers are a small cone with its tip at the camera and a line toward its target, in the agent's colour, tagged user-only (invisible to agent pictures and never picked), controlled by `Settings.showCameras` (default on). Workers use their parent's colour (see `add-agent-workers`).

**Tools and instructions.** A new tool group `cameras` (`camera_set`, `camera_list`, `camera_capture`, `camera_delete`) is granted to every agent, `capture_view` and `set_view` stay in `read`/`view`. The base instructions say: check your work with your own cameras after changing the model, use `capture_view` only to see what the user sees, and move the user's camera only when asked to show them something. The instructions version changes (old conversations are not resumed).

**Budgets.** On the reference laptop (GPU): a set of four 1024-pixel pictures under 400 ms p90 and a set of eight under 3 s, with no gap longer than 120 ms between the user's own frames while a set is taken. Measured: 204 ms for four, 312 ms for eight, longest gap 17 ms.

## Risks / Trade-offs

- [Readback cost and memory on dense models] -> render targets are created per size and reused; shots are serialised per page; the budget above is checked.
- [Hiding transient state misses an object] -> one `USER_ONLY` layer for every transient object and a test that renders with each state on and compares the picture to the clean one.
- [Section clip is renderer state, shared] -> the shot sets and restores `localClippingEnabled` and the clipping planes inside one synchronous render.
- [Software GL (no GPU) is slow] -> the same path; the size is capped lower in software mode and the timeout is reported plainly.
- [A hidden or throttled tab cannot render] -> the request goes to the most recently used page, and the error says which condition.

## Migration

None for projects. `view.capture` keeps working without `agent` (the user's view). Agents started before the change do not have the tools until restarted; the instructions version change stops old conversations being resumed.
