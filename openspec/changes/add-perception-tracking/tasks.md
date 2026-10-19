# Tasks

## 1. Test clips and model assets

- [ ] 1.1 Record the five clips (no-hands, one-hand-pinch, two-hands, head-turn, open-palm), import them as small MP4s under `test-assets/clips` with a `README.md` licence note (CC BY 4.0), with .y4m generated on demand for the fake camera; verify each plays in Chromium as a fake camera
- [x] 1.2 Add a script that downloads pinned MediaPipe WASM and `.task` model files into `apps/web/public/` and checks SHA-256; verify a second run is a no-op and a tampered file fails

## 2. Protocol and pure perception core

- [x] 2.1 Define the tracking frame schema in `packages/protocol` (no image field, strict keys); verify unit tests reject unknown keys and accept a valid frame
- [x] 2.2 Implement the One Euro filter and per-hand filter banks with the 200 ms reset; verify unit tests for the "still hand jitter" and "fast movement" scenarios
- [x] 2.3 Implement head pose decomposition from the facial transformation matrix; verify unit tests with known rotation matrices (yaw, pitch, roll each at plus and minus 30 degrees)
- [x] 2.4 Implement the adaptive scheduler (24 / 28 fps hysteresis); verify unit tests for back-off and recovery using simulated frame times

## 3. Worker and camera lifecycle

- [x] 3.1 Implement the perception worker: load both landmarkers (GPU, CPU fallback), run on transferred `ImageBitmap`s, post tracking frames; verify with a Vitest browser-mode test or a Playwright test that frames arrive
- [x] 3.2 Implement camera start and stop, the camera-on indicator and the newest-frame-wins capture loop with `requestVideoFrameCallback`; verify E2E that no permission is requested on load and that stopping ends all tracks
- [x] 3.3 Implement the camera error states (denied, not found, in use) with recovery text; verify E2E using Playwright permission denial and a page with no fake device

## 4. Debug HUD

- [ ] 4.1 Draw the mirrored preview with hand skeletons, face points and head pose axes on a canvas; verify visually against the two-hands and head-turn clips and capture a screenshot baseline in Playwright
- [x] 4.2 Show frame rate, inference time and backend, updated each second; verify E2E that the values render and change

## 5. End-to-end verification

- [ ] 5.1 Add E2E tests for the two-hands, no-hands and head-turn scenarios using their clips; verify they pass in CI on both runners
- [x] 5.2 Add the "no image data on the network" E2E test (capture network requests and bridge WebSocket frames for 10 s); verify it passes and fails if a test-only image upload is injected
- [x] 5.3 Document tracking settings and the privacy guarantee in `docs/perception.md`; verify every setting named there exists in the UI

## 6. Demo

- [ ] 6.1 Write `demos/02-tracking.md` (start camera, show HUD, open DevTools network panel, show fps and backend on the real laptop, record p90 latency) and record the Week 2 clip; verify the script reproduces the clip on a second take
