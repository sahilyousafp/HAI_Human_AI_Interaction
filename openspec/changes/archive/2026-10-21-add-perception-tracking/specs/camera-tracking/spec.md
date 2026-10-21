# Spec Delta

## Purpose

Turns the laptop webcam into a stream of hand and face measurements, on-device, so the rest of the system can react to the user's hands and head without ever handling camera images.

## ADDED Requirements

### Requirement: Camera starts only on explicit user action
The system SHALL request camera access only after the user activates a "Start camera" control, and SHALL show a persistent "Camera on" indicator in the header for as long as any camera track is live.

#### Scenario: No camera access on page load
- **WHEN** the app loads
- **THEN** no camera permission request is made and the indicator shows the camera as off

#### Scenario: Indicator follows the camera
- **WHEN** the user starts the camera and tracking is running
- **THEN** the camera-on indicator is visible
- **AND WHEN** the user activates "Stop camera"
- **THEN** every camera track is stopped and the indicator shows the camera as off

### Requirement: Camera failures explain the fix
The system SHALL show a specific message with a recovery step when no camera is found, when permission is denied, or when the camera is in use by another application. After a failure the camera indicator SHALL show off, the camera SHALL be retryable, and the rest of the app SHALL stay usable with mouse and keyboard.

#### Scenario: Permission denied
- **WHEN** the user denies camera permission
- **THEN** the app states that permission was denied and how to re-enable it in the browser site settings
- **AND** the Start camera control stays enabled and the app remains usable with mouse and keyboard

#### Scenario: No camera present
- **WHEN** no video input device exists
- **THEN** the app states that no camera was found

#### Scenario: Camera in use
- **WHEN** the camera cannot be read because another application holds it
- **THEN** the app states that the camera is being used by another app and to close it and start again

### Requirement: The user chooses the camera
The system SHALL offer a camera picker listing the system default and every video input, SHALL remember the choice in this browser, and SHALL switch over when the choice changes while the camera runs. When the remembered camera is no longer connected, starting SHALL fall back to the system default. The system SHALL ask the camera for 640 x 480 at 60 frames per second and SHALL show the size and frame rate the camera actually delivers.

#### Scenario: Picker lists the camera
- **GIVEN** the camera is running
- **WHEN** the user opens the camera picker
- **THEN** it lists the connected camera by name besides the system default, and the HUD shows what the camera delivers, such as "640 x 480, 30 fps"

### Requirement: A mirrored camera can be corrected
The system SHALL offer a "Camera image is mirrored" setting, remembered in this browser per camera. When it is on, the perception worker SHALL flip each frame back before tracking, so handedness, the pointer and head direction stay correct. The preview SHALL always be shown as a mirror view.

#### Scenario: Mirrored setting flips before tracking
- **GIVEN** an unmirrored camera shows a raised right hand that is reported as the right hand
- **WHEN** the user turns on "Camera image is mirrored"
- **THEN** at least 90% of frames with one hand report it as the left hand
- **AND** after a reload the setting is still on for that camera

### Requirement: Operating-system camera effects are turned off
When the camera starts, the system SHALL ask the browser to turn off background blur, automatic framing and eye contact correction, because they distort hand and face positions before tracking sees the image. The HUD SHALL report the effects as off, the ones still on, or not reported, and SHALL show a warning with the operating-system fix while any effect stays on.

#### Scenario: Effects state is reported
- **WHEN** the camera is running
- **THEN** the HUD shows a camera effects readout of "off", the names of the effects still on, or "not reported"

### Requirement: Camera frames never leave the perception worker
Camera images SHALL be processed only inside the perception worker and SHALL be discarded after inference. Only landmarks, blendshape values, head pose and timing data SHALL leave it. The system SHALL NOT record, store or transmit camera images, and SHALL load the tracking models and runtime from the local app rather than a third-party server.

#### Scenario: No image data on the network
- **GIVEN** tracking is running on the fake camera
- **WHEN** all network traffic and bridge messages are captured for 10 seconds
- **THEN** no request or message contains image or video data

#### Scenario: Worker output contains no pixels
- **WHEN** the perception worker posts a tracking frame
- **THEN** the message validates against the tracking frame schema, which has no field for image data

### Requirement: Hand landmarks are tracked for up to two hands
The system SHALL report, for each camera frame, up to two hands with 21 landmarks each in normalised image coordinates and in metric world coordinates, with a handedness label and a confidence value. "Right" SHALL be the user's right hand.

#### Scenario: Two hands visible
- **GIVEN** the fake camera plays the two-hands-held clip
- **WHEN** tracking runs for 3 seconds
- **THEN** at least 90% of frames report two hands with 21 landmarks each and opposite handedness labels

#### Scenario: Right hand is the right hand
- **GIVEN** the fake camera plays the one-hand-pinch clip, in which the user raises their right hand
- **WHEN** tracking runs
- **THEN** at least 90% of frames with a hand report it as "Right"

#### Scenario: No hands visible
- **GIVEN** the fake camera plays the no-hands clip
- **WHEN** tracking runs for 3 seconds
- **THEN** no frame reports a hand

### Requirement: Hand labels stay stable
A hand SHALL keep the Left or Right label it entered with for as long as it is tracked continuously, followed by palm position from frame to frame, even when the tracker's handedness guess flips as the hand crosses the face or nears the other hand. Two hands SHALL never share a label. Only a hand entering the view, or returning after 300 ms out of view, SHALL take the tracker's label, or the free label if the other hand holds it.

#### Scenario: Hand crossing the face keeps its label
- **GIVEN** the fake camera plays the hand-cross-face clip
- **WHEN** a hand sweeps across the face
- **THEN** no tracked hand changes label, no frame reports two hands with the same label, and no tap is emitted

#### Scenario: New hand takes the free label
- **GIVEN** one hand is tracked as "Right"
- **WHEN** a second hand appears that the tracker also labels "Right"
- **THEN** the second hand is reported as "Left"

### Requirement: A hand reported twice is reported once
When the tracker reports two hands in the same place, including a lower-scoring "ghost" hand fitted mostly inside a real one on a motion-blurred frame, the system SHALL report only the more confident detection.

#### Scenario: Ghost hand is dropped
- **GIVEN** a frame reports a second, lower-scoring hand mostly inside the box of a real hand
- **WHEN** labels are assigned
- **THEN** only the more confident hand is reported

### Requirement: Face, blendshapes and head pose are tracked
The system SHALL report, for each frame in which face tracking runs, 478 face landmarks, the face blendshape scores, and head pose as yaw, pitch and roll in degrees, with yaw positive when the user turns to their left, pitch positive when looking up and roll positive when tilting to their right.

#### Scenario: Head turn is measured
- **GIVEN** the fake camera plays the head-turn clip (head turns right, then left, then looks up)
- **WHEN** tracking runs over the clip
- **THEN** reported yaw goes below -15 degrees and above 15 degrees, and pitch goes above 20 degrees while looking up

### Requirement: Every tracking frame carries capture-time timestamps
Each tracking frame SHALL carry the camera capture timestamp and the time inference finished, so downstream latency can be measured from capture rather than from processing.

#### Scenario: Timestamps are ordered
- **WHEN** any tracking frame is emitted
- **THEN** its capture timestamp is earlier than or equal to its inference-finished timestamp, and capture timestamps increase across frames

### Requirement: Tracked points are smoothed without visible lag
The system SHALL smooth every tracked point so that jitter on a still hand is reduced, while a fast movement is followed with no more than 1.5 frames of added lag. Smoothing SHALL be kept per hand label, and a hand absent for more than 200 ms SHALL re-enter at its new position instead of sliding in from its old one.

#### Scenario: Still hand jitter is reduced
- **GIVEN** a synthetic stationary landmark with added noise
- **WHEN** it passes through the smoothing stage
- **THEN** the output variance is at most 25% of the input variance

#### Scenario: Fast movement is followed
- **GIVEN** a synthetic landmark that moves in a step of 30% of the image width
- **WHEN** it passes through the smoothing stage at 30 frames per second
- **THEN** the output reaches 90% of the step within 2 frames

#### Scenario: Returning hand does not slide in
- **GIVEN** a hand that was tracked on one side of the image
- **WHEN** it disappears for more than 200 ms and reappears on the other side
- **THEN** its first smoothed position is its new position

### Requirement: Tracking load adapts to keep hands responsive
The system SHALL drop camera frames that arrive while the perception worker is busy, so latency never builds up. It SHALL keep hand tracking on every processed frame and SHALL reduce face tracking to alternate frames when the measured frame rate stays below 24 frames per second for 2 seconds, restoring it when the rate recovers above 28.

#### Scenario: Face tracking backs off under load
- **GIVEN** inference is artificially slowed so the frame rate stays below 24
- **WHEN** 2 seconds pass
- **THEN** the HUD shows face tracking on every 2nd frame, hand results continue on every processed frame and face results appear on alternate frames

### Requirement: Debug HUD shows what the tracker sees
The system SHALL offer a debug view that overlays hand skeletons (one colour per hand), face points and head pose axes on the mirrored camera preview, optionally with the points before smoothing. The HUD SHALL show frame rate, inference time, what the camera delivers, the compute backend (GPU or CPU), camera effects, face tracking cadence, head yaw, pitch and roll, and frames processed and dropped, refreshed once per second.

#### Scenario: HUD reports backend and rate
- **WHEN** tracking runs with the debug view enabled
- **THEN** the HUD shows a frame rate, an inference time in milliseconds and the backend name, updated at least once per second

#### Scenario: Overlay draws both hands
- **GIVEN** the fake camera plays the two-hands clip with the debug view enabled
- **WHEN** tracking runs
- **THEN** the overlay draws a skeleton in the left-hand colour and one in the right-hand colour

### Requirement: Camera preview can be expanded
The system SHALL let the user expand the camera preview over the model area, with the sidebar still visible, and shrink it back. The choice SHALL be remembered in this browser.

#### Scenario: Expanded preview is remembered
- **WHEN** the user expands the camera preview and reloads the page
- **THEN** the preview is still shown over the model area, and shrinking it returns it to the sidebar
