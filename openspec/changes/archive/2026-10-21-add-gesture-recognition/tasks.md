# Tasks

## 1. Fixtures and schema

- [x] 1.1 Add a dev-only "record landmarks" control that exports tracking frames to JSON, and export fixtures from the five clips into `test-assets/landmarks`; verify each fixture loads and validates against the tracking frame schema
- [x] 1.2 Define the gesture event schema (discriminated union) in `packages/protocol`; verify unit tests accept every event type and reject unknown types

## 2. Hand recognisers

- [x] 2.1 Implement hand-size normalisation, finger extension ratios and palm-facing test; verify unit tests on the open-palm and one-hand-pinch fixtures
- [x] 2.2 Implement the pinch state machine with hysteresis, 60 ms minimum hold, tap vs drag; verify unit tests for "borderline distance", "brief touch", "tap" and "drag" scenarios
- [x] 2.3 Implement the clutch overlay; verify the "reposition with clutch" scenario with a synthetic sequence
- [x] 2.4 Implement the two-hand pinch stream and single-hand suppression; verify the "spreading hands" scenario on the two-hands fixture plus a synthetic spread

## 3. Engagement and head gestures

- [x] 3.1 Implement the engagement machine (300 ms open palm, 1.5 s no hands, 10 s idle); verify the three engagement scenarios
- [x] 3.2 Implement nod and shake detection over a 1.2 s buffer; verify the "nod" and "looking around" scenarios and run the head-turn fixture to confirm no false shake

## 4. Integration

- [x] 4.1 Run recognisers in the perception worker after smoothing and post gesture events in order; verify E2E that events arrive with non-decreasing timestamps
- [x] 4.2 Add the HUD gesture panel (engaged state, per-hand gesture, head gesture) and the reducer timing readout; verify E2E with the open-palm then one-hand-pinch clips
- [x] 4.3 Document the gesture vocabulary and thresholds in `docs/gestures.md` with a diagram of the state machines; verify the documented thresholds match the config object by a unit test that imports both

## 5. Demo

- [ ] 5.1 Write `demos/03-gestures.md` (raw vs smoothed toggle, engage, pinch tap and drag, clutch, two-hand, nod) and record the Week 3 clip; verify every gesture in the script fires on the real camera within two attempts
