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

### Requirement: Undo goes to the active tool first
Undo and Redo, from any entry point (Ctrl+Z, the toolbar, the Undo tool, a gesture or by voice), SHALL first go to what the active tool has of its own: Line's points while it draws, and the sketches while a sketch tool is active. Only when the tool has nothing of its own SHALL they change the model. The toolbar's buttons SHALL be enabled for either. Line's panel SHALL offer Undo point and Finish as buttons a hand can press.

#### Scenario: Undo in the middle of a line
- **GIVEN** a model with a change that can be undone, and a line of three points being drawn
- **WHEN** the user presses Ctrl+Z
- **THEN** the line has two points and the model has not changed, and Ctrl+Shift+Z brings the point back

### Requirement: A finished line can be picked and seen at any zoom
A line SHALL be drawn at a width on screen whatever the zoom, and SHALL be picked within 12 px of its span on screen, unless a surface stands in front of it.

#### Scenario: A click beside a thin line
- **GIVEN** a finished line
- **WHEN** the user clicks 8 px beside its span with Select
- **THEN** the line is selected

### Requirement: A line's points can be moved and removed after it is placed
With Move or Delete active, or on a selected line, a line's points SHALL show as handles. A pinch on a handle with Move SHALL move that point through the drawing aids, as one undo step. A tap on a handle with Delete SHALL remove that point, as one undo step. A closed line left with two points SHALL open. Removing one of a line's last two points SHALL ask about the whole line. A pinch or tap along the span SHALL act on the whole line, as for any element.

#### Scenario: Move one point
- **GIVEN** a finished line and Move active
- **WHEN** the user drags a point's handle
- **THEN** only that point moves, and one Undo puts it back

#### Scenario: Delete one point
- **GIVEN** a finished line of three points and Delete active
- **WHEN** the user taps the handle of its middle point
- **THEN** the line has two points, and one Undo puts it back

### Requirement: Line is one tool, Straight or Freeform
The Line tool SHALL have a toggle between Straight and Freeform in its panel at the right of the view, which a hand can press and which can be picked by voice. In Freeform a drag SHALL trace one line element through where the pointer went, as one undo step, with no drawing aid and no constraint, and the panel SHALL hide the controls that do not apply. Sketch line SHALL stay a separate note for the agent.

#### Scenario: Trace a curve
- **GIVEN** Line in Freeform
- **WHEN** the user drags along a curve and lets go
- **THEN** one line element follows the curve, off the grid, the view has not orbited, and one Undo removes it

### Requirement: Every tool acts on the whole selection and whole groups
Select and Lasso select SHALL select the whole group of any member. Move, Copy, Delete and Rotate SHALL act on the whole selection when used on part of it, else on the element with the rest of its group, as one undo step. Delete SHALL ask once.

#### Scenario: Delete a group
- **GIVEN** a group of three
- **WHEN** the user taps one with Delete and confirms
- **THEN** all three go, after one question, and one Undo brings all three back

### Requirement: Rotate turns a selection by hand
A Rotate tool SHALL turn what is selected, or the element or group a drag starts on, about the centre of its plan box as one body, showing the turn and its angle while dragging, in the angle step when Ortho is on, as one undo step. With nothing under the drag and nothing selected the view SHALL orbit.

#### Scenario: Turn a group
- **GIVEN** a group and Rotate active
- **WHEN** the user drags round its middle
- **THEN** its members keep their distances apart, and one Undo puts them back

### Requirement: An options card is pinned to what is selected
While Select is active and something is selected, a card SHALL be pinned to the top middle of it, naming what is selected and offering Ungroup or Group, Move, Rotate, Copy, Delete, Hide and Ask agent, as buttons a hand can press. It SHALL follow the camera, stay inside the view, and cover no other panel when there is room. Ungroup and Group SHALL be one press and one undo step, and the model under the card SHALL NOT be picked through it.

#### Scenario: Ungroup
- **GIVEN** a group selected
- **WHEN** the user presses Ungroup on the card
- **THEN** its members are on their own and still selected, and one Undo puts the group back
