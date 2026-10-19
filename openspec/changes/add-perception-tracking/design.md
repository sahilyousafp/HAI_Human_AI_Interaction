# Design

## Context

Builds on `bootstrap-workspace` (web shell, protocol package, Playwright with fake camera). Research (`docs/research/computer-vision.md`) settled the library: MediaPipe Tasks for web (`@mediapipe/tasks-vision` 1.1.x, Apache-2.0). Its GPU delegate works in the browser on Windows, while the Python GPU delegate is Linux-only.

## Goals / Non-Goals

**Goals:**
- Hands at camera rate on a mid-range laptop iGPU, with face tracking adding as little cost as possible.
- A tracking stream that is unit-testable without a camera (pure functions over landmark arrays).
- A privacy guarantee enforced by structure (types and process boundary), not just by convention.

**Non-Goals:**
- Gesture semantics (next change).
- Eye-gaze estimation beyond head pose and eye blendshapes.

## Decisions

**Run both landmarkers in one dedicated Web Worker.** The main thread grabs frames with `requestVideoFrameCallback` (which provides the capture timestamp), creates an `ImageBitmap` and transfers it to the worker. The worker runs `HandLandmarker.detectForVideo` and `FaceLandmarker.detectForVideo` (VIDEO running mode) on an `OffscreenCanvas` GPU context, then closes the bitmap. Rejected: main-thread inference (blocks React and three.js rendering); one worker per model (two GPU contexts, more memory, no gain on an iGPU).

**Backpressure: newest frame wins.** If the worker is busy, the main thread drops the frame instead of queueing it. Latency stays bounded at the cost of skipped frames. Rejected: a frame queue (latency grows without bound under load).

**Models served locally.** `hand_landmarker.task`, `face_landmarker.task` and the WASM files are copied into `apps/web/public/` at install time by a script with pinned versions and SHA-256 checks. No runtime CDN fetch, so the app works offline and no third party learns the app is running.

**Face options.** `outputFaceBlendshapes: true`, `outputFacialTransformationMatrixes: true`, `numFaces: 1`. Head pose (yaw, pitch, roll) is decomposed from the 4x4 transformation matrix in `packages/perception` as a pure function with unit tests.

**Smoothing: One Euro filter** per coordinate (Casiez et al. 2012). Defaults are min cutoff 1.0 Hz, beta 6.0 and derivative cutoff 2.0 Hz for normalised image coordinates (0..1). The common pixel-space beta of 0.007 lags badly in normalised units. A parameter sweep at 30 fps gave a worst-case jitter variance ratio of 0.19 (limit 0.25) and 95% step tracking by frame 2 (limit 90%). Head pose, in degrees, uses beta / 100. Filters reset when a hand disappears for more than 200 ms, so a re-entering hand does not slide in from its old position. Rejected: Kalman (more tuning, no better at this scale); moving average (adds lag on fast motion).

**Tracking frame schema** (`packages/protocol`): `{ captureTs, inferenceDoneTs, backend, hands: [{ handedness, score, image: Vec3[21], world: Vec3[21] }], face?: { landmarks: Vec3[478], blendshapes: Record<string, number>, headPose: { yaw, pitch, roll } } }`. It has no image field. A unit test asserts that the schema rejects unknown keys.

**Adaptive scheduler.** Exponential moving average of frame rate. Below 24 fps for 2 s, face tracking runs on alternate frames; above 28 fps it returns to every frame. The hysteresis avoids flapping.

**Test clips.** The maintainer records 5-8 s clips (no-hands, one-hand-pinch, two-hands, head-turn, open-palm). `scripts/convert-clips.mjs import` normalises them to 640x480, 30 fps H.264 MP4s committed under `test-assets/clips`, a few hundred KB each. Chromium's fake camera needs uncompressed `.y4m` (about 14 MB per second, so 110 MB for one 8 s clip), so `.y4m` files are generated on demand into `.aex/clips/` when Playwright starts, and cached. Each clip with a spec in `e2e/clips/` gets its own Playwright project launched with `--use-file-for-fake-video-capture`. Rejected: committing `.y4m` through Git LFS (about 550 MB for five clips).

**Latency budget.** Capture-to-tracking-frame at most 25 ms on GPU (p90), measured in the worker from `captureTs` to `inferenceDoneTs` and shown on the HUD. Not asserted in CI (CPU-only runners); recorded in the demo script on the real laptop.

## Risks / Trade-offs

- [GPU delegate unavailable in headless CI] → Backend falls back to CPU; tests assert behaviour, not fps.
- [ImageBitmap transfer cost at high resolution] → Capture at 640x480; tracking does not need more.
- [Two landmarkers exceed the iGPU budget] → The adaptive scheduler protects hands first; if still too slow, the face model can be disabled in settings.
- [ffmpeg missing on a machine] → CI installs it when absent; the clip README and CONTRIBUTING name it as a requirement.

## Open Questions

- Exact One Euro defaults may move slightly after real-camera testing; the scenarios define the acceptance bounds, so tuning does not change the spec.
