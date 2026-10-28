## ADDED Requirements

### Requirement: Elements can be turned and scaled
A massing and a column MAY have `rotationDeg`: degrees counter-clockwise in plan about their own centre (absent is 0). An imported element MAY have `rotationDeg` about the centre of its stored box in plan, and `scale` (above 0, absent is 1) about the foot of that centre, applied after the rotation and before its translation. Bounds, snapping, the viewer, the Rhino export and the simulation geometry SHALL place an element as these say, and a wall, slab or line SHALL turn and scale through its points.

#### Scenario: A turned massing
- **GIVEN** a massing 4000 by 2000 with its centre at (2000, 1000) and `rotationDeg` 90
- **THEN** its bounds are 2000 by 4000 about the same centre

#### Scenario: A scaled model
- **GIVEN** an imported element with `scale` 2
- **THEN** its bounds are twice as wide, deep and tall about the foot of its box centre
