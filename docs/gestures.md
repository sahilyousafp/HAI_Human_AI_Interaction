# Gestures

AEX turns smoothed hand and head tracking into a small gesture vocabulary. Everything is recognised in the perception worker, right after smoothing, and published as one ordered event stream that navigation, the tool palette and agent approvals subscribe to.

## Vocabulary

| Gesture | How to do it | Event |
|---|---|---|
| Engage | Hold an open palm toward the camera for a moment | `engaged` |
| Pinch tap | Touch thumb and index briefly, keep the other fingers relaxed open (like an OK sign) | `pinch.tap` |
| Pinch drag | Pinch and move, then open the fingers | `pinch.drag.start`, `.update`, `.end` |
| Clutch | Close the hand into a fist; move; open again | `clutch.start`, `clutch.end` |
| Two-hand pinch | Pinch with both hands; spread, bring together, move or rotate them | `twohand.start`, `.update`, `.end` |
| Nod | Nod your head down and up | `head.nod` |
| Shake | Shake your head left and right | `head.shake` |

Nothing but engagement produces a command until you are engaged. Lowering both hands out of view, or not gesturing for a while, disengages.

**Pinch versus fist.** A pinch is thumb and index together with the other fingers relaxed open. If you fold every finger around the thumb, the hand is a fist, which is the clutch. On recorded footage the two shapes are indistinguishable from hand landmarks, so this is a rule of the vocabulary rather than a tuning choice.

## Thresholds

All values live in `packages/perception/src/gestures/config.ts`; a unit test checks that this table matches it.

| Setting | Value | Meaning |
|---|---|---|
| `engage.openPalmMs` | 300 | Open palm held this long engages |
| `engage.noHandsMs` | 1500 | No hand visible this long disengages |
| `engage.idleMs` | 10000 | No gesture this long disengages |
| `pinch.press` | 0.16 | Thumb-index distance / hand size below this counts as the fingertips touching |
| `pinch.release` | 0.2 | Above this, the pinch ends (hysteresis) |
| `pinch.minHoldMs` | 60 | The fingertips must keep touching this long before a pinch starts |
| `pinch.tapMaxMs` | 250 | Shorter pinches are taps... |
| `pinch.tapMaxMove` | 0.02 | ...if they moved less than this fraction of the frame width |
| `pinch.othersMin` | 1.3 | Mean extension of the middle, ring and little fingers needed for a pinch to start |
| `pinch.lostGraceMs` | 250 | A pinching hand lost by tracking for less than this is still pinching |
| `posture.extended` | 1.35 | Finger tip-to-wrist / knuckle-to-wrist above this: extended |
| `posture.curled` | 1.15 | Below this: curled |
| `posture.thumbSpread` | 0.45 | Thumb tip to index knuckle / hand size above this: thumb spread |
| `posture.palmFacing` | 0.5 | Palm normal toward the camera (-1 to 1) above this: facing |
| `clutch.debounceMs` | 100 | A fist must hold (or be released) this long |
| `head.windowMs` | 1200 | Nod and shake are detected within this window |
| `head.nodDegrees` | 8 | Minimum pitch swing per nod reversal |
| `head.shakeDegrees` | 10 | Minimum yaw swing per shake reversal |
| `head.reversals` | 2 | Reversals needed in the window |
| `head.cooldownMs` | 1000 | After a nod or shake, head motion is ignored this long |

Hand size is the distance from the wrist to the middle-finger knuckle. The pinch distance is measured in the camera image (corrected for aspect ratio), which separates touching fingertips from open hands (about 1.2) far better than MediaPipe's 3D world coordinates. Finger extension and palm direction use the 3D world coordinates.

**A pinch means the fingertips meet.** The pinch values were set on 135 frames from the test clips, each labelled by eye as touching, near miss or fist (`test-assets/landmarks/pinch-labels.json.gz`, checked by a unit test):

| Hand | Distance / hand size | Other fingers' extension |
|---|---|---|
| Fingertips touching, held | 0.12-0.15 | 1.38 or more |
| Near miss, a visible 1-3 mm gap | 0.18-0.21 | any |
| Fist, or closing into / opening from one | as low as 0.11 | 1.17 or less |

So `press` sits between touching and a near miss, and `othersMin` keeps the thumb from triggering a pinch as it passes the index on the way into or out of a fist. A touch that turns into a fist before `minHoldMs` is dropped.

**Tracking loss.** A hand sweeping fast or passing over the face is often lost for a few frames (motion blur, skin against skin). A pinch survives a loss shorter than `lostGraceMs`, so a drag carries on from wherever the hand reappears, and a pinch interrupted by a loss never counts as a tap, because the fingers were not seen opening. Without this, pinching and sweeping a hand across the face fired a stray tap (found on a recorded clip, `test-assets/clips/hand-cross-face.mp4`).

## State machines

Per hand:

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Candidate: ratio < press and other fingers open
  Candidate --> Idle: apart again (brief touch) or fist
  Candidate --> Pinching: held minHoldMs
  Pinching --> Idle: ratio > release / tap or drag end
  Idle --> Clutch: fist held debounceMs
  Pinching --> Clutch: fist held debounceMs / drag end
  Clutch --> Idle: fist released debounceMs
```

Inside Pinching, the drag start is held back until the pinch lasts longer than `tapMaxMs` or moves more than `tapMaxMove`. Released before either, it is a tap. When both hands pinch, the two-hand stream takes over and single-hand drags pause; when one hand lets go, the other continues as a fresh drag.

Engagement:

```mermaid
stateDiagram-v2
  [*] --> NotEngaged
  NotEngaged --> Engaged: open palm held openPalmMs
  Engaged --> NotEngaged: no hands for noHandsMs
  Engaged --> NotEngaged: no gesture for idleMs
```

Disengaging ends any running drag or two-hand gesture first, so consumers never see a dangling drag.

Head: pitch and yaw over the last `windowMs` go through a zigzag filter. A reversal counts once the head has swung back by more than the threshold, and `reversals` of them make a nod (pitch) or a shake (yaw). Turning your head to look somewhere and staying there is a single movement, not a shake.

## In the HUD

The Gestures card shows whether you are engaged, what each hand is doing (open palm, pinch, drag, clutch), the last gesture (held on screen for 1.5 s so a quick tap is readable), the last head gesture, and the recogniser's time per frame.

The Detection card shows how reliably tracking works and how fast it responds:

- **Detected**: for each hand and the face, the share of frames in the last 5 seconds it was found in, with a strip of those frames (pinched frames marked) so dropouts are visible.
- **Pinch**: for each hand, a meter of the thumb-index distance with the touch (`press`) and release marks, and whether the fingertips touch. When they touch but the other fingers are curled, it says so: that hand is making a fist, not a pinch.
- **Taps / drags / two-hand**: pinch gestures recognised since the camera started.
- **Response**: the 90th percentile over the last 3 seconds of camera to gesture (from the camera capturing a frame to its gestures reaching the page) and gesture to render (to the viewer drawing the change).

## Testing

Unit tests replay landmark fixtures recorded from real clips (`test-assets/landmarks`, made with `node scripts/export-landmarks.mjs`) and synthetic sequences built from real template hands. End-to-end tests play recorded clips through Chromium's fake camera.
