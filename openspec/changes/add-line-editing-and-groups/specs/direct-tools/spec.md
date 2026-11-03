## ADDED Requirements

### Requirement: One pinch places one point of a line
With Line active, a hand's pinch SHALL place one point, the one the preview showed before the fingers closed. The preview SHALL stand still while the fingers are closing or closed, a hand that drifts while they are closed SHALL NOT move the point, and the view SHALL NOT orbit. A long pinch that stays still SHALL place nothing and SHALL go on to talking or the ring as it does elsewhere. The mouse SHALL keep its click to place and its drag to orbit.

#### Scenario: A pinch that drifts
- **GIVEN** a Line with one point placed and the preview at a second point
- **WHEN** the hand pinches there and moves away before letting go
- **THEN** the second point is where the preview was, and the camera has not moved

#### Scenario: The fingers closing
- **GIVEN** the preview at a point
- **WHEN** closing the fingers dips the pointer below that point
- **THEN** the preview does not move, and the pinch places the point it showed

#### Scenario: A long pinch
- **GIVEN** a Line with one point placed
- **WHEN** the hand holds a still pinch
- **THEN** the ring opens or listening starts, and no point is added

### Requirement: The hand that starts a line steers it
The hand that placed a line's first point SHALL steer the line until it is finished, also while the other hand has the focus. The other hand SHALL NOT move or add to the line, and its drag SHALL orbit.

#### Scenario: The other hand orbits
- **GIVEN** a line started with the right hand
- **WHEN** the left hand drags and then rests elsewhere while the right hand moves
- **THEN** the view has orbited and the preview follows the right hand

### Requirement: A hand's jitter does not flip a snap or an angle
For a hand, a snap to a fixed point SHALL be kept until the pointer is 36 px from it on screen, and an Ortho angle SHALL be kept until the pointer is 4 degrees past the half-way line to the next step. Within 16 px of the line's last point the angle SHALL NOT change. The mouse SHALL land where it points, with nothing kept.

#### Scenario: At the edge of a snap
- **GIVEN** a hand's point snapped to an endpoint
- **WHEN** the pointer is 30 px from it
- **THEN** the point stays on the endpoint, and at 40 px it lets go

#### Scenario: Just placed a point
- **GIVEN** a Line held at 0 degrees with the pointer 5 px from its last point
- **WHEN** jitter points the other way
- **THEN** the line stays at 0 degrees

### Requirement: Line locks to angles by default
The Line tool SHALL use its own drawing aid, Ortho for Line, which SHALL be on until the user turns it off. Other tools SHALL keep the shared Ortho, off by default. The Ortho chip in the constraints panel and the status bar SHALL show the lock of the active tool.

#### Scenario: Line and Wall each keep their own
- **GIVEN** the default settings
- **WHEN** the user picks Line and then Wall
- **THEN** Ortho shows on for Line and off for Wall
