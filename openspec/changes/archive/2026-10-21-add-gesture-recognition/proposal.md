# Proposal

## Why

Raw landmarks are not commands. The system needs a small, reliable gesture vocabulary that never fires by accident (the "Midas touch" problem) and that every later feature (navigation, selection, approving the agent) can share. Getting thresholds, hysteresis and engagement right once, with tests, avoids each feature inventing its own.

## What Changes

- Engagement: gestures only produce commands while the user is engaged (an open palm held toward the camera arms the system; hands down or idle disarms it).
- Pinch detection per hand with hysteresis and a minimum hold, distinguishing a short pinch "tap" from a pinch "drag".
- Clutch: a closed fist pauses all hand-driven control so the user can reposition or rest.
- Two-hand pinch stream: distance, midpoint and angle between hands while both pinch.
- Head gestures: nod (yes) and shake (no) from head pose over time.
- A single gesture event stream with a stable vocabulary that other features subscribe to, plus a HUD panel showing the live gesture state.

Out of scope: what gestures do in a viewer or in Rhino (later changes), custom trained gestures (later), remapping UI (later).

Demo clip (Week 3): "Jitter before and after, and a pinch that never misfires": side-by-side raw vs smoothed points, then pinch, clutch and nod lighting up the HUD.

## Capabilities

### New Capabilities

- `gesture-recognition`: engagement, pinch, clutch, two-hand pinch and head nod/shake detection, published as one gesture event stream.

### Modified Capabilities

None.

## Impact

- `packages/perception`: gesture state machines (pure TS, unit-tested on synthetic and recorded landmark sequences).
- `packages/protocol`: gesture event schema.
- `apps/web`: gesture state panel in the HUD.
- `test-assets/landmarks/*.json`: landmark sequences exported from the recorded clips for fast unit tests.
