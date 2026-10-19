# Perception: hand and face tracking

AEX turns your webcam into hand and face measurements, entirely inside your browser.

## Privacy guarantee

- **The camera starts only when you click Start camera.** Nothing is requested when the page loads.
- **A red "Camera on" indicator** shows in the header for as long as the camera is live. Stop camera ends every camera track.
- **Video never leaves the browser.** Frames go from the camera into a Web Worker, are analysed there, and are discarded. Only numbers leave the worker: 21 points per hand, 478 face points, face blendshape scores, head yaw, pitch and roll, and timing.
- **Nothing is recorded or uploaded.** The tracking message format has no field that could carry an image, and an automated test watches all network and bridge traffic for 10 seconds of tracking and fails if any image data appears.
- **Models load from this machine.** MediaPipe's WASM and model files are copied or downloaded once by `pnpm assets` (SHA-256 checked) and served locally, so no third party learns that you are using the app.
- **No emotion inference.** Face blendshapes are only used as explicit control signals in later features.

## What you see

| Control or readout | What it does |
|---|---|
| **Start camera / Stop camera** | Starts or stops the camera and the tracking worker |
| **Debug view** | Draws hand skeletons (amber = left hand, teal = right hand), face points and head axes over the mirrored preview |
| Frame rate | Tracking frames per second, smoothed |
| Inference | Time the worker spent on the last frame, in ms |
| Backend | GPU (WebGL in the worker) or CPU (fallback) |
| Hands | Number of hands in the last frame (0-2) |
| Face tracking | "every frame", or "every 2nd frame" when the machine is under load |
| Head yaw / pitch / roll | Degrees. Yaw is positive when you turn to your left, pitch when you look up, roll when you tilt to your right |
| Frames / dropped | Frames processed and camera frames skipped because the worker was busy |

Readouts refresh once per second; the overlay redraws every animation frame.

## How it works

1. The main thread receives camera frames with `requestVideoFrameCallback`, which provides the capture time.
2. If the worker is free, the frame becomes an `ImageBitmap` and is transferred (not copied) to the worker. If it is busy, the frame is dropped, so latency never builds up.
3. The worker runs MediaPipe Hand Landmarker (2 hands) and Face Landmarker (blendshapes and transformation matrix) on the GPU when possible.
4. Results are converted to a tracking frame, smoothed with a One Euro filter (min cutoff 1 Hz, beta 6, derivative cutoff 2 Hz in normalised image units), and posted back. The bitmap is closed immediately.
5. When the frame rate stays below 24 fps for 2 seconds, face tracking runs on alternate frames. It returns to every frame above 28 fps. Hands always run on every frame.

AEX feeds unmirrored camera frames to MediaPipe, which labels them correctly, so "Right" is your right hand. This was checked against recorded footage: a raised right hand is reported as "Right", and turning your head to your right gives negative yaw.

## Troubleshooting

| Message | Fix |
|---|---|
| Camera permission was denied | Click the camera icon in the address bar (or Site settings), allow the camera, start again |
| No camera was found | Connect a webcam or enable it in Windows Settings > Privacy & security > Camera |
| The camera is being used by another app | Close Teams, Zoom or other camera apps, start again |
| Backend shows CPU | WebGL is unavailable or blocked. Tracking still works, slower. Check `edge://gpu` or `chrome://gpu` |

## For developers

- Code: `packages/perception` (pure, unit-tested: smoothing, head pose, scheduler, MediaPipe adapter) and `apps/web/src/perception` (worker, camera, HUD).
- `pnpm assets` fetches and verifies model files; `node scripts/fetch-assets.mjs --check` verifies without downloading.
- Test hook: `?perfDelay=<ms>` adds artificial work per frame to exercise the load scheduler. It is for tests only and is not a user setting.
