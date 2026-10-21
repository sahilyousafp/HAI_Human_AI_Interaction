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

The camera view floats at the bottom right of the model: the mirrored preview with the tracked points drawn over it, **Start camera / Stop camera**, whether you are engaged, what each hand is doing with how reliably it is found, and the last gesture. Everything else is in **Settings > Camera and tracking** (the gear at the top right, or Ctrl+,). The camera keeps running whatever the view and the settings show.

| Control or readout | Where | What it does |
|---|---|---|
| **Start camera / Stop camera** | Camera view | Starts or stops the camera and the tracking worker |
| **Expand / shrink** | Camera view, top right | Shows the camera over the whole model (the largest view that fits, the model dimmed behind it), so you can check framing and tracking from a distance. The hand pointers stay on top. The same button brings it back. Remembered in this browser |
| **Hide** | Camera view, top right | Tucks the view into a small **Camera** pill (the camera keeps running); press the pill to bring it back. Remembered in this browser |
| **Camera** | Settings | Which camera to use; remembered in this browser. Switching while the camera runs switches over |
| **Camera image is mirrored** | Settings | Turn on if your camera sends a mirrored image (see "Using a phone as the camera"); remembered per camera |
| **Show tracked points** | Settings | Draws hand skeletons (amber = left hand, blue = right hand), face points and head axes over the mirrored preview |
| Frame rate | Settings | Tracking frames per second, smoothed |
| Inference | Settings | Time the worker spent on the last frame, in ms |
| Camera delivers | Settings | The size and frame rate the camera actually gives (60 fps is asked for, cameras that cannot give 30) |
| Backend | Settings | GPU (WebGL in the worker) or CPU (fallback) |
| Camera effects | Settings | Background blur, automatic framing and eye contact applied by the operating system: "off", the ones still on, or "not reported" when the browser cannot tell |
| Face tracking | Settings | "every frame", or "every 2nd frame" when the machine is under load |
| Head yaw / pitch / roll | Settings | Degrees. Yaw is positive when you turn to your left, pitch when you look up, roll when you tilt to your right |
| Frames / dropped | Settings | Frames processed and camera frames skipped because the worker was busy |

Readouts refresh once per second; the overlay redraws every animation frame. How often each hand and the face are found, the live pinch distance and the response times are in the Detection card (see [gestures.md](gestures.md#in-the-hud)).

## How it works

1. The main thread receives camera frames with `requestVideoFrameCallback`, which provides the capture time.
2. If the worker is free, the frame becomes an `ImageBitmap` and is transferred (not copied) to the worker. If it is busy, the frame is dropped, so latency never builds up.
3. The worker runs MediaPipe Hand Landmarker (2 hands) and Face Landmarker (blendshapes and transformation matrix) on the GPU when possible.
4. Each hand keeps a stable Left/Right label (see below).
5. Results are converted to a tracking frame, smoothed with a One Euro filter (min cutoff 1 Hz, beta 6, derivative cutoff 2 Hz in normalised image units), and posted back. The bitmap is closed immediately.
6. When the frame rate stays below 24 fps for 2 seconds, face tracking runs on alternate frames. It returns to every frame above 28 fps. Hands always run on every frame.

AEX feeds unmirrored camera frames to MediaPipe, which labels them correctly, so "Right" is your right hand. This was checked against recorded footage: a raised right hand is reported as "Right", and turning your head to your right gives negative yaw.

**Stable hand labels.** MediaPipe guesses handedness on every frame from the hand's appearance, and the guess fails when a hand crosses your face or comes near the other hand: the label flips, or both hands get the same one. Smoothing and pinch state are kept per label, so a flip would end a drag, fire a stray tap or merge two hands into one. `HandIdentity` (`packages/perception/src/hand-identity.ts`) therefore follows each hand by position: a hand keeps the label it entered with while it stays in view, two hands never share a label, and only a hand entering the view (or returning after 300 ms away) takes MediaPipe's label, or the free one if the other hand already holds it. It also drops a hand reported twice: on motion-blurred frames MediaPipe sometimes fits a lower-scoring "ghost" hand inside the real one, which could otherwise start a two-hand gesture nobody made.

**Camera effects.** Windows Studio Effects (on laptops with an NPU), and similar effects on macOS and ChromeOS, change the image before the browser sees it. Background blur smears fingertips that leave your outline and can fill the gap between thumb and index; automatic framing crops and pans, so a still hand appears to move; eye contact warps the face. AEX asks the browser to turn all three off when the camera starts. Where the browser cannot (Edge and Chrome only expose these controls with experimental web platform features enabled), turn them off yourself: Quick settings (Windows+A) > Studio effects, or Settings > Bluetooth & devices > Cameras > your camera.

## Using a phone as the camera

A phone's camera is usually sharper than a laptop's, copes better with low light and often runs at 60 fps, which halves motion blur, the main reason a fast-moving hand is lost. Connect it as a webcam:

- **Windows 11, Android**: Settings > Bluetooth & devices > Mobile devices, turn on using the phone as a connected camera (Phone Link).
- **Any phone**: a webcam app such as Camo, DroidCam or Iriun. Prefer a USB connection; Wi-Fi adds delay, visible as a higher camera-to-gesture time in the Detection card.

Then choose it under **Camera**. Turn off the phone app's own effects (portrait or background blur, beauty filters, auto-framing) for the same reasons as Windows Studio Effects. Some apps send a mirrored image: raise your right hand, and if the Gestures card calls it the left hand, tick **Camera image is mirrored**. AEX then flips each frame back before tracking, so handedness, the pointer and head direction all stay correct.

## Troubleshooting

| Message | Fix |
|---|---|
| Camera permission was denied | Click the camera icon in the address bar (or Site settings), allow the camera, start again |
| No camera was found | Connect a webcam or enable it in Windows Settings > Privacy & security > Camera |
| The camera is being used by another app | Close Teams, Zoom or other camera apps, start again |
| Camera effects shows blur, framing or eye contact | Turn them off in Quick settings (Windows+A) > Studio effects. They make pinches and hand positions unreliable |
| Backend shows CPU | WebGL is unavailable or blocked. Tracking still works, slower. Check `edge://gpu` or `chrome://gpu` |

## For developers

- Code: `packages/perception` (pure, unit-tested: smoothing, head pose, scheduler, MediaPipe adapter) and `apps/web/src/perception` (worker, camera, HUD).
- `pnpm assets` fetches and verifies model files; `node scripts/fetch-assets.mjs --check` verifies without downloading.
- Test hook: `?perfDelay=<ms>` adds artificial work per frame to exercise the load scheduler. It is for tests only and is not a user setting.
