## ADDED Requirements

### Requirement: Drawing aids are switches in the settings
Settings SHALL have a "Drawing aids" page with a switch for each aid: Grid, Ortho, Endpoint, Midpoint, Centre, Project and Perpendicular, each with a one-line description. Grid SHALL be on and the rest off until the user changes them. The choices SHALL be kept in the workspace settings and SHALL be shared by every browser, and a change SHALL apply to the very next point drawn. Hands SHALL be able to press every switch. The status bar SHALL show the names of the aids that are on.

#### Scenario: Turning an aid on
- **WHEN** the user opens Settings > Drawing aids and turns on Endpoint
- **THEN** the switch is on, the status bar lists Grid and Endpoint, and the choice is still on after a reload

#### Scenario: Defaults
- **GIVEN** a workspace with no stored choices
- **WHEN** the Drawing aids page opens
- **THEN** only Grid is on

### Requirement: Points snap to existing geometry
While drawing or moving, the point under the pointer SHALL be resolved by the aids that are on, in this order, taking the first that applies within 24 px on screen: Endpoint (a wall's ends, a slab's corners, a column's centre, a massing's or an imported element's bounding-box corners), Midpoint (of a wall, a slab edge or a bounding-box edge), Centre (of a slab, a massing or an imported element's bounding box, and a column), Perpendicular (the foot of the perpendicular from the line's start onto an existing edge), Project (the nearest point on an existing edge), then Grid (100 mm). The snapped point SHALL be exact to the millimetre, SHALL be shown with a marker and the aid's name, and SHALL be the point the element is created with. With no aid on, the point SHALL be the free ground point.

#### Scenario: Endpoint
- **GIVEN** Endpoint is on and a wall ends at (5000, 2000)
- **WHEN** the user starts a new wall with the pointer 12 px from that end
- **THEN** the new wall starts at exactly (5000, 2000) and a marker named Endpoint is shown

#### Scenario: Midpoint
- **GIVEN** Midpoint is on and a wall runs from (0, 0) to (6000, 0)
- **WHEN** the pointer is near the middle of that wall
- **THEN** the point is (3000, 0), marked Midpoint

#### Scenario: Project onto an edge
- **GIVEN** Project is on and a wall runs from (0, 0) to (6000, 0)
- **WHEN** the pointer is over (2437, 150) on the ground
- **THEN** the point is (2437, 0), marked Project, not a grid point

#### Scenario: Perpendicular
- **GIVEN** Perpendicular is on, a wall runs from (0, 0) to (6000, 0) and a new wall starts at (2000, 3000)
- **WHEN** the pointer is near that wall
- **THEN** the new wall's end is at (2000, 0), marked Perpendicular

#### Scenario: Priority and distance
- **GIVEN** Endpoint and Grid are on and an endpoint is 30 px from the pointer
- **WHEN** the user draws
- **THEN** the point snaps to the grid, not the endpoint

#### Scenario: Nothing on
- **GIVEN** every aid is off
- **WHEN** the user draws a wall
- **THEN** the wall's ends are the unsnapped ground points

### Requirement: Ortho locks lines to the axes
While Ortho is on, the end of a line being drawn or of a move SHALL be constrained to the X axis, the Y axis, or the 45 degree diagonals through its start, whichever is within 7.5 degrees of the pointer's direction, and otherwise be free. Ortho SHALL combine with the other aids: the point snaps within the allowed direction. The notice SHALL show the length and the angle while drawing.

#### Scenario: A line drawn nearly along X
- **GIVEN** Ortho is on
- **WHEN** the user drags a wall from (0, 0) to a point that is 5000 mm along X and 200 mm along Y
- **THEN** the wall ends at (5000, 0)

#### Scenario: A diagonal
- **GIVEN** Ortho is on
- **WHEN** the drag direction is 40 degrees
- **THEN** the end lies on the 45 degree line through the start

#### Scenario: Ortho with a snap
- **GIVEN** Ortho and Midpoint are on
- **WHEN** the end is near a midpoint that is not on an allowed direction
- **THEN** the end keeps the allowed direction and the notice says Ortho

#### Scenario: Off
- **GIVEN** Ortho is off
- **WHEN** the user drags a wall at 20 degrees
- **THEN** the wall is drawn at 20 degrees

### Requirement: The aids are available to every tool that places a point
Wall, Slab, Column, Copy and Move SHALL all resolve their points through the same aids. The aids SHALL be solved without the agent and SHALL add no more than 2 ms to the frame in which the pointer moves, for scenes of up to 2000 elements.

#### Scenario: Move snaps by an endpoint
- **GIVEN** Move is active and Endpoint is on
- **WHEN** the user drags a column so that its centre is 10 px from a wall's end
- **THEN** the column's centre is committed at that end

#### Scenario: Cost
- **GIVEN** a scene of 2000 elements
- **WHEN** the aids resolve one point with every aid on
- **THEN** it takes at most 2 ms
