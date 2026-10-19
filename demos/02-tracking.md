# Demo 02 - "21 hand points and 478 face points, and nothing leaves the laptop"

Week 2 clip. Target length 40-60 s, 4:5 or 16:9, captions burned in.

## Setup (before recording)

1. Good front light on your face, plain background, sit 50-70 cm from the laptop.
2. `pnpm dev` at the repo root; open http://127.0.0.1:5173 in Edge (dark theme).
3. Open DevTools (F12) on the Network tab, docked to the right. Clear it. Tick "Preserve log".
4. Close other camera apps (Teams, Zoom).
5. Start the recorder (OBS or Cap) at 1080p, 30 fps, capturing the browser window.

## Shot list

| # | Time | On screen | Voice-over / caption |
|---|---|---|---|
| 1 | 0-3 s | Header shows "Camera off". Click **Start camera**. | "This is my webcam, turned into a 3D input device." |
| 2 | 3-12 s | Raise both hands: amber and teal skeletons follow your fingers. Wiggle the fingers. | "21 points on each hand, tracked live in the browser." |
| 3 | 12-20 s | Hands down, turn your head left and right: face points and head axes follow; yaw readout changes sign. | "478 points on the face, plus where my head is pointing." |
| 4 | 20-30 s | Point at the readouts: fps, inference ms, backend GPU. | "On the laptop's own GPU: about N frames a second, M milliseconds per frame." |
| 5 | 30-42 s | DevTools Network panel: no requests while you move. | "And the video never leaves this tab. No uploads, no recording. Only the points." |
| 6 | 42-50 s | Click **Stop camera**: the red "Camera on" pill turns to "Camera off". | "Off means off." |
| 7 | 50-55 s | README roadmap. | "Next week: turning these points into gestures that never misfire." |

## Numbers to record on the real laptop (fill in before posting)

- Backend: ______ (GPU expected)
- Frame rate with hands + face: ______ fps
- Inference time: ______ ms
- Capture-to-tracking p90 (inference readout under steady load): ______ ms (design target: 25 ms on GPU)
- Face tracking cadence under normal use: ______ (expected: every frame)

## Expected result

- No camera prompt until Start camera is clicked.
- Skeletons line up with your hands in the mirrored preview; your right hand is drawn teal.
- The Network panel shows no new requests while tracking runs.
- Stop camera turns the indicator off and the webcam light goes out.

## Check after recording

- Captions readable on a phone; no DevTools text too small to read (zoom the panel if needed).
- No personal information visible in the background or browser tabs.
