# Spec Delta

## Purpose

Turns the laptop webcam into a stream of hand and face measurements, on-device, so the rest of the system can react to the user's hands and head without ever handling camera images.

## ADDED Requirements

### Requirement: Camera starts only on explicit user action
The system SHALL request camera access only after the user activates a "Start camera" control, and SHALL show a persistent camera-on indicator for as long as any camera track is live.

#### Scenario: No camera access on page load
- **WHEN** the app loads
- **THEN** no camera permission request is made and the indicator shows the camera as off

#### Scenario: Indicator follows the camera
- **WHEN** the user starts the camera and tracking is running
- **THEN** the camera-on indicator is visible
- **AND WHEN** the user activates "Stop camera"
- **THEN** every camera track is stopped and the indicator shows the camera as off

### Requirement: Camera failures explain the fix
The system SHALL show a specific message with a recovery step when no camera is found, when permission is denied, or when the camera is in use by another application.

#### Scenario: Permission denied
- **WHEN** the user denies camera permission
- **THEN** the app states that permission was denied and how to re-enable it in the browser site settings
- **AND** the app remains usable with mouse and keyboard

#### Scenario: No camera present
- **WHEN** no video input device exists
- **THEN** the app states that no camera was found

### Requirement: Camera frames never leave the perception worker
Camera images SHALL be processed only inside the perception worker. Only landmarks, blendshape values, head pose and timing data SHALL leave it. The system SHALL NOT record, store or transmit camera images.

#### Scenario: No image data on the network
- **GIVEN** tracking is running on a recorded clip
- **WHEN** all network traffic and bridge messages are captured for 10 seconds
- **THEN** no request or message contains image or video data

#### Scenario: Worker output contains no pixels
- **WHEN** the perception worker posts a tracking frame
- **THEN** the message validates against the tracking frame schema, which has no field for image data

### Requirement: Hand landmarks are tracked for up to two hands
The system SHALL report, for each camera frame, up to two hands with 21 landmarks each in normalised image coordinates and in metric world coordinates, with a handedness label and a confidence value.

#### Scenario: Two hands visible
- **GIVEN** the fake camera plays the two-hands clip
- **WHEN** tracking runs for 3 seconds
- **THEN** at least 90% of frames report two hands with 21 landmarks each and opposite handedness labels

#### Scenario: No hands visible
- **GIVEN** the fake camera plays the no-hands clip
- **WHEN** tracking runs for 3 seconds
- **THEN** no frame reports a hand

### Requirement: Face, blendshapes and head pose are tracked
The system SHALL report, for each frame in which face tracking runs, 478 face landmarks, the face blendshape scores, and head pose as yaw, pitch and roll in degrees.

#### Scenario: Head turn is measured
- **GIVEN** the fake camera plays the head-turn clip (head turns left then right)
- **WHEN** tracking runs over the clip
- **THEN** reported yaw changes sign between the two halves of the clip with a magnitude above 15 degrees in each half

### Requirement: Every tracking frame carries capture-time timestamps
Each tracking frame SHALL carry the camera capture timestamp and the time inference finished, so downstream latency can be measured from capture rather than from processing.

#### Scenario: Timestamps are ordered
- **WHEN** any tracking frame is emitted
- **THEN** its capture timestamp is earlier than or equal to its inference-finished timestamp, and capture timestamps increase across frames

### Requirement: Tracked points are smoothed without visible lag
The system SHALL smooth every tracked point so that jitter on a still hand is reduced, while a fast movement is followed with no more than 1.5 frames of added lag.

#### Scenario: Still hand jitter is reduced
- **GIVEN** a synthetic stationary landmark with added noise
- **WHEN** it passes through the smoothing stage
- **THEN** the output variance is at most 25% of the input variance

#### Scenario: Fast movement is followed
- **GIVEN** a synthetic landmark that moves in a step of 30% of the image width
- **WHEN** it passes through the smoothing stage at 30 frames per second
- **THEN** the output reaches 90% of the step within 2 frames

### Requirement: Tracking load adapts to keep hands responsive
The system SHALL keep hand tracking on every frame and SHALL reduce face tracking to alternate frames when the measured frame rate stays below 24 frames per second for 2 seconds, restoring it when the rate recovers above 28.

#### Scenario: Face tracking backs off under load
- **GIVEN** inference is artificially slowed so the frame rate falls to 20
- **WHEN** 2 seconds pass
- **THEN** hand results continue on every frame and face results appear on alternate frames

### Requirement: Debug HUD shows what the tracker sees
The system SHALL offer a debug view that overlays hand skeletons, face points and head pose axes on a mirrored camera preview, together with frame rate, inference time and the active compute backend (GPU or CPU).

#### Scenario: HUD reports backend and rate
- **WHEN** tracking runs with the debug view enabled
- **THEN** the HUD shows a frame rate, an inference time in milliseconds and the backend name, updated at least once per second
