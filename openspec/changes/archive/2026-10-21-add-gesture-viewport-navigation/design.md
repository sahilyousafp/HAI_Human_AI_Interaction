# Design

## Context

Consumes gesture events from `add-gesture-recognition`. The bridge from `bootstrap-workspace` gains its first real state. The agent change that follows will edit this scene through MCP tools, so the scene must live where the agent's tools can reach it without a browser round trip.

## Goals / Non-Goals

**Goals:**
- Scene logic fully testable in Node (no DOM, no three.js in `packages/scene`).
- Smooth, predictable hand navigation that feels like a turntable, which suits buildings.
- The model looks architectural on camera from day one (it is a demo product).

**Non-Goals:**
- Real geometry kernel (booleans, NURBS). Elements are parametric primitives. Precision modelling is Rhino's job.
- Multi-user editing semantics beyond "last write wins, ordered patches".

## Decisions

**Scene document.** `{ version, units: "mm", up: "Z", levels: Level[], elements: Record<id, Element> }`. Element is a discriminated union:
- massing: origin and size
- slab: outline polygon, thickness, level
- wall: baseline start and end, height, thickness, level
- column: position, section, height, level

Ids are ULIDs. Schemas are zod in `packages/protocol`, shared by bridge, web and MCP tools.

**Operations and transactions.** Pure `apply(doc, op) -> { doc, inverse }` for `create`, `update` (shallow field patch), `delete`. A transaction is a labelled list of ops. Its inverse list goes on the undo stack. Patches broadcast to clients are the op lists themselves, with a monotonically increasing sequence number. A client that misses a sequence number requests a fresh snapshot. Rejected: CRDT library such as Yjs (unneeded for one user with one authoritative server); full-snapshot broadcast (wasteful once scenes grow).

**Persistence.** The bridge writes `<project>/scene.aex.json` with a debounced (2 s) atomic write: write a temp file, then rename. The project folder is chosen from the web UI and remembered in `.aex/settings.json`. Rejected: browser storage (the agent and Rhino could not see it).

**Viewer.** React Three Fiber with a Z-up camera (`camera.up = (0,0,1)`). Elements render as extruded meshes with `MeshStandardMaterial` in off-white, `Edges` outlines, a directional sun with soft shadows and an infinite ground grid in metres. Units convert from mm to scene units of 1 m at render time only.

**Navigation controller.** A small custom turntable controller (azimuth, elevation, distance, target) instead of OrbitControls, because both mouse input and gesture events must drive the same state. Gesture deltas map with gain and a light exponential ease (time constant 40 ms). Two-hand: zoom is the log ratio of distances, pan is the midpoint delta scaled by distance. Mouse input maps onto the same controller. Rejected: drei `OrbitControls` (hard to drive programmatically without fighting its own pointer handling).

**Pointer and picking.** Pointer position is the mirrored pinch point mapped to the canvas. Raycasting runs at most once per animation frame against element meshes, using three's BVH-free raycaster (scene sizes are small). Hover highlight uses an emissive tint. Selection is sent to the bridge; the highlight renders immediately and is reconciled when the bridge echoes it back.

**Latency measurement.** Each gesture event carries `captureTs`. The controller stamps the camera change with it. In `useFrame` after render, latency is `performance.now()` minus `captureTs`. A rolling p90 over 3 s is shown on the HUD. `performance.now()` is shared by the worker and the main thread through `performance.timeOrigin`, so timestamps are converted once.

## Risks / Trade-offs

- [Hand orbit feels too sensitive or too sluggish] → Gains in one config with a HUD slider during development; demo script records chosen values.
- [Pointer drifts during pinch tap] → Taps use the pinch-start position, not the end position.
- [Atomic rename on Windows fails if the file is open in another program] → Retry with backoff; surface an error banner after 3 failures.
