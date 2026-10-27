## ADDED Requirements

### Requirement: Line draws a polyline point by point
With Line active, a tap or click SHALL place each point, snapped by the drawing aids that are on, and the segment from the last point SHALL follow the pointer with its length and angle in the notice. Tapping the last point again, a nod or Enter SHALL finish the line as one undo step labelled "Add Line N"; tapping the first point of a line of three or more SHALL close it; Escape or a shake SHALL take back the last point and, with none left, return to Select. A line of one point SHALL never be added.

#### Scenario: Draw and finish
- **GIVEN** Line is active
- **WHEN** the user taps three points and presses Enter
- **THEN** one line through the three points is added on the ground level, and one Undo removes it

#### Scenario: Close a line
- **WHEN** the user taps four points and then the first again
- **THEN** a closed line of three points is added

### Requirement: Ortho holds a line to an angle step
With Ortho on, each segment SHALL take the nearest multiple of the angle step (90, 45 or 15 degrees from the X axis, 45 by default, remembered) from where it starts, however far the pointer is from it. The step SHALL be chosen in the constraints panel.

#### Scenario: A hand off the axis
- **GIVEN** Ortho is on with a step of 90 degrees
- **WHEN** the pointer is 20 degrees off the X axis from the start point
- **THEN** the point lands on the axis

### Requirement: A length can be set for a segment
The user SHALL be able to set a length (millimetres) for the next segment of a Line or Wall: the point SHALL lie exactly that far from the start along the Ortho direction, or towards the pointer without Ortho, and no snap or the grid SHALL move it. The length SHALL be freed once the point is placed or the tool changes.

#### Scenario: A locked length
- **GIVEN** a Line with its first point placed and a length of 2500 mm locked
- **WHEN** the user taps anywhere
- **THEN** the second point is 2500 mm from the first and the length is free again

### Requirement: Constraints are shown while drawing
While Line or Wall is active a panel SHALL show Ortho and its angle step, the length and the point snaps (Grid, Endpoint, Midpoint, Centre, Project, Perpendicular), each a control a hand can press. The switches SHALL be the same as Settings > Drawing aids, so a change in one shows in the other.

#### Scenario: Panel and Settings agree
- **WHEN** the user switches Ortho on in the panel
- **THEN** Settings > Drawing aids shows Ortho on, and the status bar lists it

### Requirement: Line is picked by name
Saying "line" SHALL pick the Line tool and "sketch line" or "path" the Sketch line tool; Line SHALL have the shortcut N and a slot in the reference ring.

#### Scenario: Tool names
- **WHEN** the user says "line" and, later, "sketch line"
- **THEN** Line is picked first and Sketch line second
