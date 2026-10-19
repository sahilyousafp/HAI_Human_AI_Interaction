# Proposal

## Why

Everything the product does starts from knowing where the user's hands and head are. The browser can track both on a laptop GPU in real time, on-device, so this change builds that foundation and makes the privacy promise (video never leaves the laptop) concrete and testable before anything depends on it.

## What Changes

- Camera start and stop with an explicit user action, a visible "camera on" indicator, and clear recovery messages when the camera is missing or blocked.
- A perception Web Worker that runs hand tracking (up to two hands, 21 landmarks each) and face tracking (478 landmarks, blendshapes, head pose) on every frame, using the GPU when available and falling back to CPU.
- Jitter smoothing on all tracked points, tuned so still hands look still and fast hands do not lag.
- A debug HUD over a mirrored camera preview: hand skeletons, face points, head pose axes, frame rate and inference time.
- Adaptive load: when frame rate drops, face tracking runs on alternate frames before hand tracking is touched.
- Recorded test clips (no hands, one hand, two hands, head turn) so tracking is tested end to end in CI with a fake camera.

Out of scope: gesture meaning (pinch, engage, nod), any 3D viewer, voice, eye-gaze tracking.

Demo clip (Week 2): "21 hand points and 478 face points, live, and nothing leaves the laptop", showing the HUD and the browser network panel staying silent.

## Capabilities

### New Capabilities

- `camera-tracking`: camera lifecycle, on-device hand and face tracking, smoothing, performance telemetry and the privacy guarantees around camera frames.

### Modified Capabilities

None.

## Impact

- `apps/web`: camera controls, HUD canvas, worker host.
- `packages/perception`: worker entry, model loading, smoothing filters, frame scheduling.
- `packages/protocol`: tracking frame message schema (landmarks, blendshapes, head pose, timestamps).
- New dependency: `@mediapipe/tasks-vision` (Apache-2.0) and its model files, served locally from `apps/web/public/models` (not fetched from a CDN at runtime).
- `test-assets/clips/*.y4m`: maintainer-recorded clips, CC BY 4.0.
