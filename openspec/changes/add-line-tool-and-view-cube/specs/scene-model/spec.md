## ADDED Requirements

### Requirement: A line is a polyline element
The scene SHALL have a `line` element: at least two points in millimetres at their real heights, and a `closed` flag (false unless set). A closed line SHALL have at least three points. A line is a curve: it has no thickness or height, it SHALL appear in the model as a thin tube, and it SHALL be saved to a Rhino file as a polyline curve on a layer named Lines. Its bounds SHALL be those of its points, and moving it SHALL move all its points in plan.

#### Scenario: A line of one point is refused
- **WHEN** a scene or an operation holds a line with a single point, or a closed line with two
- **THEN** it is rejected

#### Scenario: A line is saved as a curve
- **GIVEN** a closed line through three points
- **WHEN** the project is saved as a Rhino file
- **THEN** the file holds one polyline curve on the Lines layer through the points and back to the first
