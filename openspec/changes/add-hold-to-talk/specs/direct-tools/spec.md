## ADDED Requirements

### Requirement: Sketch line draws a path for the agent
With Sketch line active, a pinch-drag SHALL draw a path through the drawing aids, simplified so no point lies within 100 mm of the line between its neighbours. A path shorter than 300 mm SHALL add nothing. The path SHALL be shown dashed in the colour of the hand that drew it, labelled S1, S2 and so on. It SHALL NOT be a model element and SHALL NOT be an undo step.

#### Scenario: Draw a path
- **GIVEN** Sketch line is active
- **WHEN** the user pinch-drags 6000 mm across the ground in an L shape and releases
- **THEN** a dashed path labelled S1 with three points is shown and the scene has no new element

#### Scenario: Too short
- **WHEN** the user pinch-drags 200 mm with Sketch line and releases
- **THEN** no sketch is added

### Requirement: Sketch area draws an outline for the agent
With Sketch area active, a pinch-drag SHALL draw an outline through the drawing aids that is closed on release, simplified as for Sketch line. An outline enclosing less than 1 square metre SHALL add nothing. It SHALL be shown dashed and lightly filled in the hand's colour, labelled like a path. It SHALL NOT be a model element and SHALL NOT be an undo step.

#### Scenario: Outline a courtyard
- **GIVEN** Sketch area is active
- **WHEN** the user pinch-drags around a 10 m by 8 m region and releases away from the start
- **THEN** a closed dashed outline enclosing about 80 square metres is shown and the scene has no new element

### Requirement: Sketches last until a request uses them
At most 8 sketches SHALL be kept; a ninth SHALL replace the oldest. Sending a request SHALL carry every sketch and then clear them. Escape, while Sketch line or Sketch area is active and nothing else is pending, SHALL clear them, as SHALL tapping a sketch with Delete (that one only).

#### Scenario: A request clears sketches
- **GIVEN** two sketches are shown
- **WHEN** a request is sent
- **THEN** the request carries both sketches and the view shows none

#### Scenario: Delete one sketch
- **GIVEN** sketches S1 and S2 are shown
- **WHEN** the user taps S2 with Delete
- **THEN** only S1 remains and no confirmation is asked

### Requirement: Place marker puts lettered points that the project keeps
With Place marker active, a tap SHALL place a marker at the point the drawing aids resolve, lettered with the first free letter from A to Z. Tapping an existing marker with Place marker or Delete SHALL remove it. Markers SHALL NOT be model elements, SHALL be kept by the bridge with the project across restarts, and SHALL NOT be cleared by sending a request.

#### Scenario: Two markers
- **GIVEN** Place marker is active and there are no markers
- **WHEN** the user taps two places on the ground
- **THEN** markers A and B are shown at those points

#### Scenario: Markers survive a restart
- **GIVEN** markers A and B exist
- **WHEN** the app and the bridge are restarted
- **THEN** markers A and B are shown at the same points

#### Scenario: Letters are reused
- **GIVEN** markers A and B exist and the user removes A
- **WHEN** the user places a new marker
- **THEN** it is lettered A
