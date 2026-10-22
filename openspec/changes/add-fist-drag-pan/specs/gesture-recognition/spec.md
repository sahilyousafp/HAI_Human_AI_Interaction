## MODIFIED Requirements

### Requirement: Closed fist acts as a clutch
When a hand holds a closed fist for 100 ms, the system SHALL emit a clutch start for that hand and end any drag it was making; when the fist has been open for 100 ms it SHALL emit a clutch end. Fist frames SHALL never be read as a pinch or a tap, so a pinch after the clutch starts a fresh drag from the new position without a jump. A fist that closes while its hand is dragging SHALL remain a pure clutch until it opens: moving it SHALL emit no fist drag.

#### Scenario: Reposition with clutch
- **GIVEN** a drag is in progress
- **WHEN** the hand closes into a fist, moves, and reopens into a pinch
- **THEN** no drag updates and no fist drag events are emitted while the fist is closed, and the resumed drag starts from the new position without a jump

## ADDED Requirements

### Requirement: A moving fist is a fist drag
While engaged, a fist that was closed at rest (not while its hand was dragging) and then moves 3% of the image width or more from where its clutch started SHALL emit a fist drag start at that position, followed by fist drag updates carrying the hand's movement, until the hand stops being a fist or is lost for longer than 250 ms, when it SHALL emit a fist drag end. The start SHALL carry the clutch position, so no movement is lost to the threshold. The position SHALL be a point of the hand that does not move as the fingers curl. Fist drag events SHALL be emitted for each hand on its own, and never while both hands are fists.

#### Scenario: Moving fist drags
- **GIVEN** the system is engaged and a hand is open
- **WHEN** the hand closes into a fist, holds for 150 ms, and moves 10% of the image width to the right
- **THEN** a clutch start, one fist drag start and fist drag updates summing to 10% to the right are emitted, and no pinch event

#### Scenario: Closing the hand is not a drag
- **WHEN** an open hand closes into a fist and stays still
- **THEN** a clutch start is emitted and no fist drag start

#### Scenario: Small jitter is not a drag
- **WHEN** a fist wobbles by 1% of the image width
- **THEN** no fist drag start is emitted

#### Scenario: Opening the fist ends the drag
- **GIVEN** a fist drag is running
- **WHEN** the hand opens
- **THEN** one fist drag end is emitted at the first frame that is no longer a fist, and the opening movement is not part of the drag

#### Scenario: Both fists end it
- **GIVEN** a fist drag is running with one hand
- **WHEN** the other hand closes into a fist
- **THEN** the fist drag ends, no fist drag is emitted for either hand while both are fists, and the stop gesture arms as before

#### Scenario: A fist closed mid-drag is only a clutch
- **GIVEN** a pinch drag is running
- **WHEN** the hand closes into a fist and moves 20% of the image width
- **THEN** no fist drag is emitted

### Requirement: Fist drag is a per-hand gesture setting
The Gestures card SHALL list **Fist drag** as a one-hand gesture with a choice for each hand: pan the view (the default), orbit the view, or nothing. The existing fist gesture SHALL be listed as **Fist hold**, described as closing the hand and keeping it still for a second and a half, with its actions unchanged. A hand whose fist drag is set to nothing SHALL stay a pure clutch. The choice SHALL be kept with the other gesture settings, settings saved before this gesture existed SHALL load with the default, and "Reset to defaults" SHALL restore it. The Fist drag row SHALL light up when the camera detects a fist drag.

#### Scenario: Default is pan for both hands
- **WHEN** the user opens Settings > Gestures with default settings
- **THEN** Fist drag shows "Pan the view" for the left hand and for the right hand

#### Scenario: Old settings still load
- **GIVEN** a settings file saved before Fist drag existed
- **WHEN** the app starts
- **THEN** the file is accepted and Fist drag is "Pan the view" for both hands

#### Scenario: Nothing keeps the clutch
- **GIVEN** the right hand's Fist drag is set to nothing
- **WHEN** the right hand closes into a fist and moves
- **THEN** the view does not move

#### Scenario: Fist drag lights its row
- **GIVEN** the system is engaged
- **WHEN** the user closes a hand and moves it
- **THEN** the Fist drag row lights up and then goes dark again
