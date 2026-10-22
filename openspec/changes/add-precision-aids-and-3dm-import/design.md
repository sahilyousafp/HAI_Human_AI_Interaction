# Design

## Context

- Hand pointers are drawn by the viewer's pointer loop (`Viewer.tsx`): each frame it maps a hand to a screen point (`input/hand-mapping.ts`), looks up the pressable control under it (`pressableAt`, `elementAt` plus the `PRESSABLE` selector) and publishes `{ at, client, overControl }`. Taps and drags go through `InputRouter` to `ToolController`, whose environment calls `press(at)` and `isButton(at)` with a viewer position and no notion of which hand. A pinch's own position drifts while the fingers close, which is why near misses happen.
- The create tools snap only to the 100 mm grid (`tools/grid.ts`, `groundPoint` in `tools/create.ts`; Move and Copy use `snap()` on offsets). There is no concept of anchor, axis lock or snapping to other elements.
- Scene validation is strict (`packages/protocol/src/scene.ts`, a zod discriminated union of massing, slab, wall and column). The scene is one JSON file rewritten atomically by the autosaver every 2 s, and every change is broadcast whole to clients over the WebSocket.
- The bridge's HTTP server answers only `/health` and `/mcp`; everything else is on the token-protected WebSocket. The web app is served from another origin (Vite, port 5173).
- Nothing reads a `.3dm` today and no file picker or drop handler exists, so dropping a `.3dm` on the page makes the browser try to open or download it. `docs/research/hosts.md` already names rhino3dm (MIT) as the way to read Rhino files without Rhino.
- Settings choices live in the bridge's `.hai/settings.json`; features are a list in `packages/protocol/src/features.ts` with only changed choices stored.

## Goals / Non-Goals

**Goals:**
- Snapping to a button never adds a frame of latency to the gesture path, and never steals a drag meant for the model.
- One snap solver for every tool, with no dependency on React or three.js, so it is unit-tested with plain numbers.
- Importing never blocks the main thread, never loses information silently, and never makes the scene file or the WebSocket carry triangles.

**Non-Goals:**
- Snapping to the surface of imported meshes (needs raycasts against triangles; bounding boxes only for now).
- A general asset system for other file types; the asset container is simple on purpose so glTF or IFC import can reuse it later.
- Smart guides, tracking lines or alignment hints beyond Ortho and Perpendicular.

## Decisions

**Button snapping is a small per-hand state machine in its own module.**
- `input/pointer-snap.ts` is pure: given a hand's screen point, the pressable controls' rectangles, whether the hand is dragging, and the previous state, it returns the next state `{ target, locked }`. Distance is from the point to the rectangle (zero inside), so wide rows and small icon buttons both catch at the same distance from their edge.
- Capture 28 px, release 44 px (hysteresis), so the pointer does not flicker between two controls. A pinch that begins while snapped sets `locked`, and the target stays until the pinch ends.
- The drawn pointer goes to the control's centre when the control is at most 48 px across and to the nearest point inside it otherwise, so a wide settings row does not pull the pointer sideways.
- The viewer's pointer loop calls it once per hand per frame, after `handPointer`, and feeds the result into the existing `markHover` and `shown[hand]` state; `ToolEnvironment.press` and `isButton` gain a `hand` parameter and resolve through the hand's snap state before falling back to `pressableAt`.
- Rectangles come from one `querySelectorAll(PRESSABLE)` per frame filtered to visible, enabled, non-inert controls, with the same `inert` and `hidden` rules `elementAt` already honours. Controls under an open ring or a covering panel are dropped by checking that `elementFromPoint` at the control's centre is the control or inside it.
- Latency budget: at most 0.5 ms per frame for 200 controls, measured by a unit benchmark; the existing gesture-to-render p90 readout must stay within 1 ms of its value with the switch off (checked in the E2E latency test).
- The switch is the feature `snapToButtons` in `FEATURES`, so it appears in Settings > Features and is stored the usual way.
- *Rejected:* bigger CSS hit areas (does not move the drawn pointer and overlaps neighbours); snapping the mouse (the mouse is already exact); a fixed pull strength instead of capture and release distances (feels sticky and flickers between neighbours).

**One pure snap solver, fed screen tolerance.**
- `packages/scene/src/snap.ts` exports `resolvePoint({ raw, anchor, aids, doc, mmPerPixel })` returning `{ point, kind, label } | null` plus the guide it used. It takes millimetres and a pixels-to-millimetres scale at the pointer (a new `ToolContext.mmPerPixel(at)`), so 24 px is the same on screen whatever the zoom.
- Order of work: Ortho first (it constrains the raw point to the allowed ray from the anchor), then candidate points from existing geometry in the order Endpoint, Midpoint, Centre, Perpendicular, Project, taking the first within tolerance (a candidate must also lie on the ortho ray when Ortho is on), then Grid on what is left.
- Candidates come from elements in plan (walls, slab edges, columns, massing footprints, imported bounding boxes) as points and segments. A scan over 2000 elements is cheap; a bounding-box test rejects most before any distance is taken. No spatial index until a benchmark says so (task 3.5 measures it).
- All aids work on the horizontal plane of the level being drawn on. This matches how the create tools already place points (`ctx.ground`).
- The aids reach tools through `ToolContext.aids()` and the solver through `ToolContext.resolve(at, anchor)`, so `dragToDraw`, Copy and Move call one function and the old `groundPoint`/`snap(offset)` paths are folded into it. With only Grid on, results equal today's, which keeps the existing tests valid.
- The marker and label are drawn from a new `ToolOverlay.snap` field, and the length and angle are added to the draft's notice.
- *Rejected:* solving in the Viewer with three.js raycasts (hard to test, couples tools to the renderer); a "Shift to disable snapping" key (hands have no Shift; the switches are the control for now); doing the snap in the bridge (it is on the gesture path and must not wait on a round trip).

**Project means "nearest point on an edge".**
- The request lists snap, ortho and projection. In CAD the closest match is Rhino's *Project* (and *Nearest*): the point is carried onto the geometry that is near the pointer. Here that is the nearest point on a wall baseline, slab edge or bounding-box edge, in plan. Perpendicular is the companion for lines. If "projection" was meant as projecting onto the view plane or a construction plane, it is a different aid and a small addition to the same solver.

**Drawing aids are stored like feature choices.**
- `DrawingAids` in the protocol (ids, labels, descriptions, defaults; Grid on) and `Settings.drawingAids` hold only the changed choices; the bridge merges updates so changing one never resets another, exactly as `Settings.features`.
- The web side has a `DrawingAidsStore` shaped like `FeatureFlags` (subscribe, snapshot, `set`), read by tools at the moment they act, so a switch applies to the next point.
- The Drawing aids page is a new `SettingsSection` built from the same `Switch` rows as Features.

**3DM is read in a Web Worker with rhino3dm, converted, and uploaded as an asset.**
- *Where:* `import/rhino-worker.ts` loads rhino3dm's WebAssembly from our own origin (copied into `public/rhino3dm/` next to the mediapipe files, and added to the runtime-files plugin and the licence notices). The main thread only hands over the file and shows progress. Reading in the bridge was rejected: the bridge would block on parsing and the browser could not show progress as easily; reading in the main thread was rejected because a 100 MB file would freeze the hands.
- *What becomes geometry:* Mesh objects as they are; Brep and Extrusion objects through their face render meshes (`face.getMesh(MeshType.Any)`); SubD and everything else counted as skipped. Colours come from the object's display colour, falling back to its layer's. Units come from the file's unit system and are scaled to millimetres; Rhino is already Z-up.
- *Blocks:* instance references are expanded with their transforms if rhino3dm exposes them (confirmed by the spike in task 1.1); otherwise they are reported as skipped blocks and the spec's wording still holds.
- *Many objects:* real models have tens of thousands of objects (a stand with 48 692 objects and 2.9 million triangles was the first real file tried), and one scene element each would make a 20 MB scene file that the autosaver rewrites every 2 s and every client receives whole. Above 1000 objects the parts are merged per layer and display colour, so the element count is the number of layers. Picking, moving and the agent then work at layer level for such models; the report says so. Rejected: a limit that refuses big models (they are the ones people want), and a separate "object" level inside an element (a second selection model).
- *Missing render meshes:* a Brep saved with Rhino's "Save small" has none. Those objects are counted as "no mesh" and the report tells the user to save without "Save small".
- *Container:* one binary asset per import, `assets/<id>.haimesh` in the project folder: a small JSON header (parts, with vertex and index counts and byte offsets) and then little-endian Float32 positions and Uint32 indices. Normals are computed by the viewer. Each imported element has `asset` and `part`. Rejected: base64 in the scene file (autosave rewrites it every 2 s and every client gets it on every patch), glTF/GLB (a loader and axis conversion for no gain yet; can be added as a second asset kind), re-serving the original `.3dm` (every viewer would need the rhino3dm WASM and a parse on load).
- *Transport:* the bridge gets a token-protected HTTP route for assets: `PUT /assets/<id>` and `GET /assets/<id>`, with `Authorization: Bearer <token>` compared in constant time (the existing `tokensMatch`), CORS limited to the allowed origins, ids validated against `[a-f0-9-]{36}` so no path is ever taken from the client, bodies streamed to a temporary file then renamed, and a 500 MB limit. Rejected: sending the bytes over the WebSocket (one 100 MB frame would stall every other message and the gesture-adjacent traffic).
- *Order and undo:* the browser uploads first, then sends one `scene.apply` of N `create` ops, so the import is one undo step and an upload that fails changes nothing. Undo removes the elements and leaves the asset; unused assets are removed when a project opens (a crash between upload and apply, or an undone import that was then saved, cannot leak files forever).
- *Missing asset:* the viewer draws the element's bounding box and the project status names the asset.

**Imported elements are reference geometry with a translation.**
- `ImportedElement` in the protocol: `asset`, `part`, `bounds` (min, max in mm), `translation` (x, y, z mm), optional `layer` and `color`. The tools' existing `shifted()` handles it by changing `translation`, so Move, Copy and the agent's `update` reuse the same path and the asset never changes. Bounds for framing and snapping are `bounds` plus `translation`.
- The agent's scene read serialises these without any vertex data, because it only ever sees the element JSON.
- Rendering: the viewer fetches each asset once, keeps it by id, and builds one mesh per part so picking, selection outline and section clipping work as for other elements. If a model of 2000 parts proves too many draw calls, parts are merged per layer for display only (task 5.4 measures it; picking then uses a part-id lookup).

**Drop and picker share one path.**
- A window-level `dragover`/`drop` handler calls `preventDefault` for file drags (which also stops the browser opening the file) and hands the first file to the same `importFile` function the button uses. A drag-over message shows on the viewer. Non-`.3dm` files get a clear message.

## Risks / Trade-offs

- [rhino3dm cannot expand blocks or read some Breps] → a spike on real files first (task 1.1); every skipped object is counted and explained, never silent.
- [Large models make the viewer slow] → the limits (500 MB, 5 million triangles) are checked in the worker before upload, the render path is measured with a 2000-part fixture, and per-layer merging is the planned fallback.
- [rhino3dm's WASM is about 2.7 MB] → loaded only in the import worker, only on the first import, and cached by the browser.
- [A mis-scaled file (units unknown) comes in huge or tiny] → the file's unit system is used and shown in the report ("read as metres"), and the view frames the result so it is never lost off screen.
- [Button snapping steals taps meant for the model near a toolbar] → the capture radius is small, the snap never starts during a drag, and the switch turns it off.
- [A pinch that starts snapped on one control and ends elsewhere surprises the user] → by design it presses the control it started on; the pointer stays drawn on it so it is visible.
- [Grid-only defaults mean new aids go unnoticed] → the status bar lists the aids that are on, and the demo shows turning them on.

## Migration Plan

- Existing scenes and projects open unchanged; `imported` is a new element type, so a scene with imported elements opened by an older build fails validation with the element's id in the error (strict schema, as for any unknown type). No data of existing projects is rewritten.
- Settings gain `drawingAids` and the `snapToButtons` feature; stored settings without them resolve to the defaults. Rollback is removing the feature; the stored fields are ignored by older builds.
- Roadmap: this is Week 11; the Rhino connector and the weeks after it move down by one, as when Week 10 was added.
