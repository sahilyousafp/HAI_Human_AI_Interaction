# gesture-recognition Specification

## Purpose
Turns smoothed hand and head tracking into a small, deliberate gesture vocabulary that never fires by accident, shared by every feature that reacts to the user's body.

## Requirements

### Requirement: Gestures produce commands only while engaged
The system SHALL emit gesture events other than engaged and disengaged only while engaged, and a pinch that began before engaging SHALL stay ignored until it ends. Holding an open palm toward the camera for 300 ms SHALL engage. No hand visible for 1.5 s, or 10 s without any gesture or open palm, SHALL disengage. Disengaging SHALL first end any running drag or two-hand gesture.

#### Scenario: Pinch before engaging is ignored
- **GIVEN** the system is disengaged
- **WHEN** the user pinches
- **THEN** no pinch command is emitted

#### Scenario: Open palm engages
- **GIVEN** the system is disengaged
- **WHEN** an open palm faces the camera for 300 ms
- **THEN** an engaged event is emitted and later pinches emit commands

#### Scenario: Hands leaving disengages
- **GIVEN** the system is engaged
- **WHEN** no hand is visible for 1.5 s
- **THEN** a disengaged event with the reason "no-hands" is emitted

#### Scenario: Idle disengages
- **GIVEN** the system is engaged
- **WHEN** 10 s pass without any gesture
- **THEN** a disengaged event with the reason "idle" is emitted

### Requirement: Pinch uses hysteresis and a minimum hold
A pinch SHALL begin when the thumb-tip to index-tip distance in the camera image, divided by hand size (wrist to middle-finger knuckle), stays below 0.168 for at least 60 ms while the middle, ring and little fingers are open (mean extension of at least 1.3), and SHALL end only when the ratio rises above 0.2. A closed fist SHALL never start a pinch, including while the thumb passes the index on the way into or out of the fist.

#### Scenario: Borderline distance does not flicker
- **GIVEN** a pinch is active
- **WHEN** the normalised distance oscillates between 0.17 and 0.19
- **THEN** the pinch stays active and no extra start or end events are emitted

#### Scenario: Brief touch is not a pinch
- **WHEN** the normalised distance is below 0.168 for only 30 ms
- **THEN** no pinch starts

#### Scenario: Near miss is not a pinch
- **WHEN** the fingertips hover just apart, with the normalised distance between 0.18 and 0.21
- **THEN** no pinch starts

#### Scenario: Closing into a fist is not a pinch
- **WHEN** the hand closes into a fist and opens again
- **THEN** no pinch, tap or drag event is emitted

### Requirement: Still pinches are taps, moving pinches are drags
A pinch that moves 4% of the image width or more from where it started SHALL be reported as a drag, with start, update and end events carrying the pinch point position. A pinch released before 800 ms that moved less than 4% of the image width SHALL be reported as one tap at the position where it started, however long it lasted, but only once the fingers open past a ratio of 0.3 within 200 ms of the release.

#### Scenario: Tap
- **WHEN** a pinch lasts 500 ms with negligible movement and the fingers then open
- **THEN** a single tap event is emitted with its position and no drag events

#### Scenario: Shaky tap still clicks
- **WHEN** a pinch drifts 3% of the image width and is released
- **THEN** a single tap event is emitted

#### Scenario: Half-closed hand does not click
- **WHEN** the distance dips below 0.168 for about 200 ms and then stays near 0.23
- **THEN** no tap event is emitted

#### Scenario: Drag
- **WHEN** a pinch lasts 800 ms while moving
- **THEN** drag start, one or more drag updates, and drag end are emitted in order

### Requirement: Pinches survive brief tracking loss
A pinching hand that tracking loses for less than 250 ms SHALL still count as pinching, and a drag SHALL carry on from wherever the hand reappears. A pinch interrupted by a tracking loss SHALL never be reported as a tap.

#### Scenario: Drag survives a short loss
- **GIVEN** a drag is in progress
- **WHEN** the hand is lost for 150 ms and reappears further along
- **THEN** no drag end is emitted during the loss and drag updates continue from the new position

#### Scenario: Lost pinch is not a tap
- **WHEN** a still pinch is lost by tracking and the hand reappears open
- **THEN** no tap event is emitted

### Requirement: Closed fist acts as a clutch
When a hand holds a closed fist for 100 ms, the system SHALL emit a clutch start for that hand and end any drag it was making; when the fist has been open for 100 ms it SHALL emit a clutch end. Fist frames SHALL never be read as a pinch or a tap, so a pinch after the clutch starts a fresh drag from the new position without a jump.

#### Scenario: Reposition with clutch
- **GIVEN** a drag is in progress
- **WHEN** the hand closes into a fist, moves, and reopens into a pinch
- **THEN** no drag updates are emitted while the fist is closed and the resumed drag starts from the new position without a jump

### Requirement: Two-hand pinch reports distance, midpoint and angle
While both hands pinch, the system SHALL emit a two-hand stream (start, updates, end) with the distance between pinch points as a fraction of the image width, their midpoint and the angle in degrees of the line from the left to the right pinch point, and SHALL end and suppress single-hand drags for those hands. When one hand lets go, the other SHALL continue as a fresh drag from its current position once it moves, and SHALL NOT produce a tap or a long pinch.

#### Scenario: Spreading hands
- **GIVEN** both hands pinch
- **WHEN** the hands move apart
- **THEN** two-hand updates report increasing distance and no single-hand drag updates are emitted

### Requirement: Head nod and shake are recognised
While engaged, the system SHALL recognise a nod (at least two pitch reversals over 8 degrees within 1.2 s) as yes and a shake (at least two yaw reversals over 10 degrees within 1.2 s) as no, SHALL ignore head motion for 1 s after either so one gesture fires once, and SHALL NOT report either during ordinary head movement.

#### Scenario: Nod
- **WHEN** head pitch goes down 12 degrees, up 12 degrees and down again within 1 s
- **THEN** a nod event is emitted once

#### Scenario: Shake
- **WHEN** head yaw turns 12 degrees left, 12 degrees right and left again within 1 s
- **THEN** a shake event is emitted once

#### Scenario: Looking around is not a shake
- **WHEN** head yaw turns 20 degrees to one side and stays there
- **THEN** no shake event is emitted

### Requirement: Two open palms stop
While engaged, holding both open palms toward the camera for 500 ms SHALL emit one stop event. Another stop SHALL require lowering a hand first.

#### Scenario: One stop per hold
- **GIVEN** the system is engaged
- **WHEN** both open palms face the camera for 1 s
- **THEN** exactly one stop event is emitted
- **AND WHEN** one hand is lowered and both palms are held again for 500 ms
- **THEN** a second stop event is emitted

#### Scenario: No stop while disengaged
- **GIVEN** the system is disengaged
- **WHEN** both open palms face the camera for 500 ms without engaging
- **THEN** no stop event is emitted

### Requirement: One gesture event stream with a stable vocabulary
All gesture output SHALL be recognised in the perception worker right after smoothing and published as one ordered event stream. Every event SHALL carry a type, a confidence value, the capture timestamp of the frame that produced it, and the hand (left, right, or both for two-hand events) where relevant. Positions SHALL be normalised and mirrored to match the preview.

#### Scenario: Events validate
- **WHEN** any gesture event is emitted
- **THEN** it validates against the gesture event schema and its timestamp is not earlier than the previous event's

### Requirement: Live gesture state is visible
The HUD SHALL show whether the system is engaged (with a hint to hold an open palm while not engaged), what each hand is doing (relaxed, open palm, pinch, drag or clutch), the last gesture held on screen for 1.5 s, the last head gesture, and the recogniser's time per frame.

#### Scenario: HUD reflects engagement
- **GIVEN** the fake camera plays the open-palm-then-pinch clip
- **WHEN** the clip plays
- **THEN** the HUD shows engaged and then a pinch gesture on the right hand

### Requirement: Detection card shows tracking reliability and response time
The HUD SHALL show, for each hand and the face, the share of frames in the last 5 seconds in which it was found, with a strip of those frames that marks dropouts and pinched frames; for each hand, a meter of the pinch distance with the press and release marks and a note when the fingertips touch but the hand is a fist; counts of taps, drags and two-hand gestures since the camera started; and the 90th percentile over the last 3 seconds of camera-to-gesture and gesture-to-render time.

#### Scenario: Detection card reports the right hand
- **GIVEN** the fake camera plays the one-hand-pinch clip
- **WHEN** tracking runs
- **THEN** the right hand is detected in more than half the frames, the left hand in none, the right hand's pinch distance is shown and camera-to-gesture time is shown in milliseconds

### Requirement: Gesture actions are configurable
A Gestures card SHALL list every gesture with how to make it and what it does, each in a choice of the actions that gesture can take, marking the default. Open palm SHALL always engage. The choices SHALL be kept by the bridge in the workspace settings so they survive reloads, browsers and restarts, and "Reset to defaults" SHALL restore every default. A gesture's row SHALL light up when the camera detects that gesture.

#### Scenario: Choice survives a reload
- **WHEN** the user sets pinch tap to select and reloads the page
- **THEN** pinch tap is still set to select and a tap selects what it points at whatever the active tool

#### Scenario: Detected gesture lights its row
- **GIVEN** the system is engaged
- **WHEN** the user taps
- **THEN** the pinch tap row lights up and then goes dark again

### Requirement: Long pinch is reported as a hold
A pinch held for 800 ms while moving less than 4% of the image width SHALL emit one hold event at the pinch position, together with the start of a drag. The pinch SHALL then continue as a drag until release, so the same pinch can be steered after the hold, and SHALL NOT be reported as a tap. A pinch that has moved 4% of the image width SHALL never hold, even if it stops later.

#### Scenario: Hold then steer
- **GIVEN** the system is engaged
- **WHEN** the user pinches, keeps the hand still for 800 ms, then moves and releases
- **THEN** a hold event is emitted once at 800 ms, followed by drag updates and a drag end, and no tap

#### Scenario: Moving pinch never holds
- **WHEN** the user pinches and moves steadily for 1 s
- **THEN** no hold event is emitted

#### Scenario: A pinch that moved and stopped does not hold
- **WHEN** the user pinches, moves the hand more than 4% of the image width, then keeps it still for 1 s
- **THEN** no hold event is emitted
