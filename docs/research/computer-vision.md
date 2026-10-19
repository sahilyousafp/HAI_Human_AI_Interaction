# Computer vision: libraries, interaction techniques, datasets

Research date: 2026-10-19.

**Short answer:** v0.1 = MediaPipe Tasks in the browser (Hand Landmarker + Face Landmarker), One Euro filter, rule-based gestures in a state machine, plus a small classifier trained on HaGRIDv2 landmarks. Head pose for coarse pointing. Eye-gaze and Python backends later.

Two 2025-2026 changes: **Model Maker is deprecated** ("still available, but is no longer actively maintained"), and **LiteRT.js launched 2026-07-09** as the successor to TensorFlow.js (it does not replace MediaPipe Tasks).

## A) Tracking libraries

### MediaPipe Tasks
- Active repo ([releases](https://github.com/google-ai-edge/mediapipe/releases)), Apache-2.0, under the "Google AI Edge" brand. LiteRT is the renamed TensorFlow Lite runtime underneath, not a deprecation. The deprecated part is legacy `mp.solutions` (unsupported since 2023-03-01). Tasks API is current.
- Web: `@mediapipe/tasks-vision` (WASM + GPU delegate). Recent: IIFE bundles, Vite worker support, per-landmark presence. WebGPU for vision tasks unconfirmed, plan on WebGL2/CPU.
- Python on Windows: GPU delegate "currently limited to Ubuntu", so Windows Python is CPU-only. Strong reason to run in browser.
- LiteRT.js (`@litertjs/core`): runs any .tflite via WebGPU / WASM / experimental WebNN. Use for custom models (gesture classifier).

| Task | Output | Pixel 6 latency | Notes |
|---|---|---|---|
| [Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker) | 21 landmarks per hand (image + world), handedness | 17 ms CPU / 12 ms GPU | Main hand signal |
| [Gesture Recognizer](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer) | 7 built-in gestures | 17 ms CPU | Custom head needs deprecated Model Maker |
| [Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker) | 478 3D landmarks, 52 blendshapes, 4x4 facial transformation matrix | n/a | Matrix = head pose. Eye-look blendshapes = coarse gaze |
| Pose / Holistic | 33 body points; Holistic = pose + face + hands | n/a | Holistic web support unconfirmed |

Hands + face together at ~30 fps in Chrome on a mid-range iGPU is commonly reported; benchmark on your machine.

### Alternatives

| Library | Licence | Status | Comments |
|---|---|---|---|
| TF.js hand-pose / face-landmarks | Apache-2.0 | Low activity, superseded by LiteRT.js | Same models, skip |
| OpenCV | Apache-2.0 | Mature | Plumbing (capture, solvePnP, Kalman) |
| [RTMPose/RTMW via rtmlib](https://github.com/Tau-J/rtmlib) | Apache-2.0 code, weights unclear | Active | 100-370 MB models, too heavy for v0.1 |
| Ultralytics YOLO pose | **AGPL-3.0** or paid | Active | Copyleft spreads to app. Avoid |
| OpenPose | Non-commercial | Inactive | Avoid |
| [Handsfree.js](https://github.com/CreativeInquiry/handsfree) | Apache-2.0 | Archived 2022 | Ideas only |
| [WebGazer.js](https://webgazer.cs.brown.edu) | GPLv3 | Unmaintained since 2026-02 | Noisy, click calibration |
| [WebEyeTrack](https://github.com/RedForestAI/WebEyeTrack) | Unverified | Research-grade (2025) | BlazeGaze + 9-point calibration, 2.32 cm on GazeCapture |
| [L2CS-Net](https://github.com/Ahmednull/L2CS-Net) | MIT code, NC-data weights | Stable | ~3.9 deg MPIIGaze |
| [GazeTracking](https://github.com/antoinelame/GazeTracking) | MIT | Inactive | Left/right/centre + blink only |
| [Project Gameface](https://github.com/google/project-gameface) | Apache-2.0 | Archived 2025-09 | Best reference for head-pose cursor + blendshape clicks |
| Ultraleap Leap Motion 2 | Proprietary | Supply uncertain | Optional precision input |
| Depth cams (Orbbec Femto Bolt, RealSense) | Vendor SDKs | Active | Not needed webcam-first |

Webcam gaze reality: ~2-5 cm on screen (3-5 deg best case). Good for "which panel/viewport", not for picking objects in a dense model. Timestamp from capture time with `requestVideoFrameCallback` ([arXiv 2608.11566](https://arxiv.org/abs/2608.11566) on under-reported browser gaze latency).

## B) Interaction techniques

| Topic | Reference | Guidance |
|---|---|---|
| Smoothing | [One Euro filter](https://gery.casiez.net/1euro/) (Casiez et al., CHI 2012) | beta=0, tune min_cutoff (~1 Hz) holding still, then raise beta (0.001 x10 steps) for fast motion |
| Pinch | Common practice | dist(4,8) / dist(0,9). Hysteresis: press < 0.25, release > 0.35, minimum hold time |
| Gesture FSM | Common practice | idle -> candidate (N frames) -> active -> release, cooldown. Require explicit engage posture or clutch |
| Midas touch | Jacob 1990/91 | Never commit on gaze alone. Dwell 200-1000 ms |
| Gaze + pinch | Pfeuffer et al. SUI 2017; [arXiv 2401.10948](https://arxiv.org/abs/2401.10948) | Look selects, pinch confirms, hand manipulates. Webcam: head pose + snap radius instead of eye gaze |
| Head-pose cursor | Camera Mouse (2002), Gameface | Relative joystick mapping, dead zone, gain curve. Blendshape clicks with per-user thresholds |
| Two-hand viewport | Guiard 1987; Song et al. CHI 2012 handle-bar | One-hand pinch = orbit. Two-hand: distance = zoom, midpoint = pan, angle = roll. Clutch to rest |
| Fatigue | [Consumed Endurance](https://doi.org/10.1145/2556288.2557130) (CHI 2014) | Hands low, elbows on desk, relative mapping, high gain. Voice/LLM for discrete commands |
| Accessibility | Gameface, Camera Mouse | Remappable gestures, head-only and voice-only modes |

## C) Datasets

NC = non-commercial. Fine for OSS research; check before shipping trained weights commercially.

### Hand gestures
| Dataset | Content | Licence | Classifier use |
|---|---|---|---|
| [HaGRIDv2](https://github.com/hukenovs/hagrid) | 1,086,158 FullHD images, 33 gestures + no_gesture, **ships MediaPipe landmarks** | CC BY-SA 4.0 variant (read licence folder) | **Best** |
| [Jester](https://www.qualcomm.com/developer/software/jester-dataset) | 148,092 clips, 27 dynamic gestures | Academic (Qualcomm) | Dynamic gestures |
| [EgoGesture](https://nlpr.ia.ac.cn/iva/yfzhang/datasets/egogesture.html) | 83 classes RGB-D egocentric | Research agreement | Low |
| NVGesture | 25 classes RGB-D, in-car | Unclear | Low |
| [IPN Hand](https://gibranbenitez.github.io/IPN_Hand/) | 4,000+ continuous interface gestures | **CC BY 4.0** | **High** |
| ChaLearn IsoGD/ConGD | 249 classes RGB-D | Research | Low |

### 3D hand pose (later)
FreiHAND (NC), [InterHand2.6M](https://github.com/facebookresearch/InterHand2.6M) (CC BY-NC), HO-3D / DexYCB / OakInk (research), [ARCTIC](https://github.com/zc-alexfan/arctic) (no commercial), 11k Hands, [HOT3D](https://www.projectaria.com/datasets/hot3D/license/) (annotations CC BY-NC-SA), GigaHands (CVPR 2025), Ego4D / Ego-Exo4D (custom agreement).

### Face / head / gaze
WFLW, 300W, AFLW2000-3D (research/NC), BIWI head pose (NC), [MPIIFaceGaze](https://www.mpi-inf.mpg.de/departments/computer-vision-and-machine-learning/research/gaze-based-human-computer-interaction/its-written-all-over-your-face-full-face-appearance-based-gaze-estimation) (CC BY-NC-SA), GazeCapture, [ETH-XGaze](https://ait.ethz.ch/xgaze) (CC BY-NC-SA), Gaze360, AffectNet (NC).

**Ethics:** emotion recognition is scientifically contested and prohibited in workplaces/education under the EU AI Act. Use blendshapes only as explicit control switches.

## D) Recommendation

v0.1 (browser, on-device):
1. `@mediapipe/tasks-vision` Hand (2 hands) + Face (blendshapes + matrix) in a Web Worker on GPU delegate, 30 fps target, face every other frame if needed.
2. One Euro filter, normalised features, capture-clock timestamps.
3. Rule gestures (pinch, two-hand pinch, open palm engage, fist clutch) in a hysteresis FSM.
4. Small MLP (63-126 inputs, 2 hidden layers) on wrist-relative scale-normalised HaGRIDv2 landmarks, later IPN Hand. PyTorch -> .tflite/ONNX -> LiteRT.js / onnxruntime-web.
5. Mapping: one-hand pinch-drag = orbit, two-hand = zoom/pan, head pose = coarse pointer + viewport focus, blendshape or voice = confirm.
6. Bridges: web viewer direct; Rhino via WebSocket to a plugin. Check [Euglena](https://discourse.mcneel.com/t/euglena-computer-vision-plugin-for-grasshopper/161957) prior art.
7. Send the LLM intents + context, never raw landmark streams.

Privacy pitch: video never leaves the browser, visible camera indicator, offline mode, no emotion inference, no video stored.

Later: WebEyeTrack coarse gaze, dynamic gestures (GRU/TCN on Jester), Holistic for posture/fatigue, Python/ONNX kiosk backend, Leap Motion / depth adapters, user study (Consumed Endurance vs mouse + 3D mouse).
