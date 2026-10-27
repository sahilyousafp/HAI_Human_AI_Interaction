## ADDED Requirements

### Requirement: A view cube switches to orthographic views
A view cube SHALL sit at the viewport's right and turn with the camera. Its faces SHALL switch to the Top, Bottom, Front, Back, Left and Right views, each a true orthographic camera framing what the perspective camera framed at its target, with Front looking from -Y, Right from +X and Top from above with north up. A Perspective control SHALL return to the turntable camera that was in use before. Panning and zooming SHALL keep an orthographic view; orbiting, framing the model or an agent's view request SHALL return to perspective. Every control of the cube SHALL be pressable by a hand.

#### Scenario: Top is a plan
- **WHEN** the user presses the Top face
- **THEN** the camera looks straight down, and two points at different heights above the same ground point appear at the same place on screen

#### Scenario: Orbiting leaves the view
- **GIVEN** the Front view
- **WHEN** the user pans and zooms, then orbits
- **THEN** the view stays Front through the pan and the zoom and becomes perspective when it orbits

### Requirement: Line draws in a side view's plane
In the Front, Back, Left and Right views the Line tool SHALL draw in the vertical plane through its first point (through the camera's target for the first point), so Ortho holds a line to that plane's two axes, a typed length applies, and Endpoint, Midpoint, Centre and Grid snap there. Tools that draw in plan SHALL place nothing in a side view.

#### Scenario: An upright line
- **GIVEN** the Front view, Line active and Ortho on with a step of 90 degrees
- **WHEN** the user taps a point and a point above it, slightly to the side
- **THEN** the line has the same x and y at both ends and the second end higher
