# Design

## Context

Consumes the smoothed tracking frames from `add-perception-tracking`. Thresholds come from common practice and the gaze+pinch literature (`docs/research/computer-vision.md`, section B).

## Goals / Non-Goals

**Goals:**
- Zero accidental commands in ordinary movement; deliberate gestures recognised within 100 ms.
- Recognisers are pure functions of a landmark sequence, so they run identically in the worker, in unit tests and in replay.

**Non-Goals:**
- Learned classifiers (the custom-gesture change replaces rule-based posture detection later, behind the same event stream).
- Per-user calibration UI (thresholds are constants with a settings override for now).

## Decisions

**Run recognisers in the perception worker**, right after smoothing, and post gesture events alongside tracking frames. This avoids a main-thread hop on the latency path. Rejected: recognising on the main thread (extra latency under React render load).

**Hand-size normalisation** uses the distance from wrist (0) to middle-finger knuckle (9). It is stable across hand distance from the camera and unaffected by finger pose.

**Posture detection** (open palm, fist) uses finger extension ratios: tip-to-wrist divided by knuckle-to-wrist, per finger. Open palm means all five fingers extended and the palm normal facing the camera (from world landmarks 0, 5 and 17). Fist means four fingers curled. Rule-based for v0.1; the custom-gesture change can swap in a classifier.

**State machines.** Each hand has `idle -> candidate -> pinching(tap|drag) -> idle`, with a clutch overlay state. Engagement is a separate machine over all hands. The head machine keeps a 1.2 s ring buffer of pitch and yaw and counts reversals above amplitude thresholds. Each machine is a reducer `(state, frame) -> (state, events[])` so recorded sequences replay deterministically.

**Event schema** (`packages/protocol`): a discriminated union on `type`: `engaged`, `disengaged`, `pinch.tap`, `pinch.drag.start|update|end`, `clutch.start|end`, `twohand.start|update|end`, `head.nod`, `head.shake`. Positions are normalised image coordinates already mirrored to match what the user sees.

**Test data.** A dev-only "record landmarks" button exports tracking frames to JSON. The five clips from the previous change produce fixtures in `test-assets/landmarks`. Unit tests replay them. Synthetic generators cover the edge cases (borderline oscillation, 30 ms touch, fist mid-drag).

**Latency budget.** Gesture recognition adds at most 2 ms per frame in the worker, measured with `performance.now()` around the reducer and shown on the HUD.

## Risks / Trade-offs

- [Thresholds tuned on one person's hands and lighting] → Constants live in one config object with settings overrides; record a second person's clips before v0.1.
- [Open palm also happens naturally (waving, gesturing while talking)] → Require 300 ms hold plus palm-facing-camera; disengage on idle.
- [Head nod confused with looking down at the keyboard] → Require two reversals within 1.2 s; a single downward look has one reversal at most.
