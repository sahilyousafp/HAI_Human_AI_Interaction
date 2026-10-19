# Spec Delta

## Purpose

Turns smoothed hand and head tracking into a small, deliberate gesture vocabulary that never fires by accident, shared by every feature that reacts to the user's body.

## ADDED Requirements

### Requirement: Gestures produce commands only while engaged
The system SHALL emit command gestures (pinch, two-hand pinch, nod, shake) only while engaged. Holding an open palm toward the camera for 300 ms SHALL engage. No hand visible for 1.5 s, or 10 s without any gesture, SHALL disengage.

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
- **THEN** a disengaged event is emitted

### Requirement: Pinch uses hysteresis and a minimum hold
A pinch SHALL begin when the thumb-tip to index-tip distance, divided by hand size, falls below 0.25 for at least 60 ms, and SHALL end only when it rises above 0.35.

#### Scenario: Borderline distance does not flicker
- **GIVEN** a pinch is active
- **WHEN** the normalised distance oscillates between 0.27 and 0.33
- **THEN** the pinch stays active and no extra start or end events are emitted

#### Scenario: Brief touch is not a pinch
- **WHEN** the normalised distance is below 0.25 for only 30 ms
- **THEN** no pinch starts

### Requirement: Short pinches are taps, held pinches are drags
A pinch that ends within 250 ms and moves less than 2% of the image width SHALL be reported as a tap. Any other pinch SHALL be reported as a drag with start, update and end events carrying the pinch point position.

#### Scenario: Tap
- **WHEN** a pinch lasts 180 ms with negligible movement
- **THEN** a single tap event is emitted with its position and no drag events

#### Scenario: Drag
- **WHEN** a pinch lasts 800 ms while moving
- **THEN** drag start, one or more drag updates, and drag end are emitted in order

### Requirement: Closed fist acts as a clutch
While a hand forms a closed fist, the system SHALL suspend that hand's drag output, and SHALL resume when the fist opens, without a position jump.

#### Scenario: Reposition with clutch
- **GIVEN** a drag is in progress
- **WHEN** the hand closes into a fist, moves, and reopens into a pinch
- **THEN** no drag updates are emitted while the fist is closed and the resumed drag starts from the new position without a jump

### Requirement: Two-hand pinch reports distance, midpoint and angle
While both hands pinch, the system SHALL emit a two-hand stream with the distance between pinch points, their midpoint and the angle of the line between them, and SHALL suppress single-hand drag events for those hands.

#### Scenario: Spreading hands
- **GIVEN** both hands pinch
- **WHEN** the hands move apart
- **THEN** two-hand updates report increasing distance and no single-hand drag updates are emitted

### Requirement: Head nod and shake are recognised
The system SHALL recognise a nod (at least two pitch reversals over 8 degrees within 1.2 s) as yes and a shake (at least two yaw reversals over 10 degrees within 1.2 s) as no, and SHALL NOT report either during ordinary head movement.

#### Scenario: Nod
- **WHEN** head pitch goes down 12 degrees, up 12 degrees and down again within 1 s
- **THEN** a nod event is emitted once

#### Scenario: Looking around is not a shake
- **WHEN** head yaw turns 20 degrees to one side and stays there
- **THEN** no shake event is emitted

### Requirement: One gesture event stream with a stable vocabulary
All gesture output SHALL be published as one ordered event stream. Every event SHALL carry a type, the hand (left, right or both, where relevant), a confidence value and the capture timestamp of the frame that produced it.

#### Scenario: Events validate
- **WHEN** any gesture event is emitted
- **THEN** it validates against the gesture event schema and its timestamp is not earlier than the previous event's

### Requirement: Live gesture state is visible
The HUD SHALL show whether the system is engaged and which gesture, if any, is active for each hand and for the head.

#### Scenario: HUD reflects engagement
- **GIVEN** the fake camera plays the open-palm clip followed by the one-hand-pinch clip
- **WHEN** the clips play
- **THEN** the HUD shows engaged and then a pinch on the correct hand
