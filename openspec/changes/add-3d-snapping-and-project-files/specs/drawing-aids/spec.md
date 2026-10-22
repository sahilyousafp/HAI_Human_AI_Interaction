## ADDED Requirements

### Requirement: Snaps work at every height
Endpoint, Midpoint, Centre, Perpendicular and Project candidates SHALL be 3D points at their real heights: a wall's ends and midpoint at its base and at its top, a column's centre at its base and at its top, a slab outline's corners and edge midpoints at the top of the slab, and the corners, edge midpoints and centre of an imported model's bounding box at both its bottom and its top. The pointer SHALL be matched to a candidate by its position on screen, within 24 px, whatever the candidate's height, and the nearest candidate in that order of aids SHALL win. A candidate hidden behind the model SHALL still snap. The snapped point SHALL keep its height, and the marker SHALL be drawn at it.

#### Scenario: A wall end on an upper level
- **GIVEN** Endpoint is on and a wall's end is at (5000, 2000) on a level at 4500 mm
- **WHEN** the pointer is 12 px from where that end appears on screen
- **THEN** the point is (5000, 2000, 4500) and the Endpoint marker is drawn there

#### Scenario: The top corner of an imported building
- **GIVEN** Endpoint is on and an imported model's bounding box is 0 to 20000 mm in X and Y and 0 to 30000 mm in Z
- **WHEN** the pointer is near the top corner (20000, 20000, 30000) on screen
- **THEN** the point is that corner, not the corner at ground level

#### Scenario: Nearest on screen wins
- **GIVEN** two endpoints at different heights that appear 10 px and 20 px from the pointer
- **WHEN** the user draws
- **THEN** the nearer one on screen is used

#### Scenario: Ground-level snapping is unchanged
- **GIVEN** Endpoint is on and the pointer is near a ground-level wall end
- **WHEN** the user draws
- **THEN** it snaps exactly as before

### Requirement: New elements are placed at the snapped height
When a point snaps to a point at height z, a tool that creates an element SHALL place it at that height: on the level whose elevation equals z (within 1 mm) when there is one, else with no level and at height z. With no height-changing snap the tools SHALL keep using the ground level. Ortho SHALL hold the line in the plane at the start point's height.

#### Scenario: A wall started on an upper level
- **GIVEN** Endpoint is on and the Wall tool is active
- **WHEN** the user starts a wall on a wall end on a level at 4500 mm and ends it at a free point
- **THEN** the new wall is on that level, and its end is at the same height

#### Scenario: No matching level
- **GIVEN** an imported roof corner at 31200 mm and no level at that height
- **WHEN** the user draws a wall starting there
- **THEN** the wall has no level and its base is at 31200 mm

#### Scenario: The ground still works
- **WHEN** the user draws a wall with no snap
- **THEN** it is on the ground level, as before

### Requirement: Measure uses the drawing aids
The Measure tool SHALL place each of its two points through the same aids as the drawing tools, in 3D. A point that snaps SHALL show its marker and name; a point with no snap SHALL be the surface point under the pointer, as before. The notice SHALL show the straight distance in millimetres and its horizontal and vertical parts.

#### Scenario: Corner to corner
- **GIVEN** Endpoint is on and two imported box corners are 6000 mm apart horizontally and 3000 mm apart in height
- **WHEN** the user taps near each corner
- **THEN** the notice reads about 6708 mm with 6000 mm across and 3000 mm up

#### Scenario: No aid near
- **WHEN** the user taps a surface with no snap in reach
- **THEN** the point is the surface point under the pointer
