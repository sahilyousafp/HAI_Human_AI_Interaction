# Spec Delta

## Purpose

Lets the user move around the model and point at and select elements with their hands, while mouse and keyboard keep working, in the built-in viewer.

## ADDED Requirements

### Requirement: The viewer shows the open scene
The built-in viewer SHALL render every element of the open scene with Z up, and SHALL frame the whole model the first time a scene arrives. The camera SHALL be a turntable that orbits around a target point and never rolls. The element under the pointer SHALL be highlighted and selected elements SHALL be shown as selected.

#### Scenario: Model in view on load
- **WHEN** the viewer loads the sample scene
- **THEN** every element is drawn, the model is in view and the camera looks down from above the ground

### Requirement: One-hand pinch-drag orbits the view
While engaged, a one-hand pinch drag SHALL orbit the camera around the current orbit target like dragging the model with the mouse: dragging right turns the camera to a lower azimuth around the Z axis (270 degrees per full image width) and dragging down raises the view (120 degrees per full image height). Elevation SHALL stay between 5 and 89 degrees.

#### Scenario: Drag right orbits
- **GIVEN** the system is engaged
- **WHEN** the user pinch-drags to the right by 20% of the image width
- **THEN** the camera azimuth changes by -54 degrees (the model turns as if dragged with the mouse) and the orbit target does not move

#### Scenario: Drag down raises the view
- **WHEN** the user pinch-drags downward
- **THEN** the camera elevation increases

#### Scenario: Elevation is clamped
- **WHEN** the user drags far enough to exceed 89 degrees elevation
- **THEN** the elevation stops at 89 degrees

### Requirement: Two-hand pinch zooms and pans
While both hands pinch, increasing the distance between them SHALL zoom in, decreasing it SHALL zoom out, in proportion to the change in distance. Moving their midpoint SHALL pan the view parallel to the screen, opposite to the hands' motion (1.2 view heights per full image of midpoint movement).

#### Scenario: Spread zooms in
- **WHEN** both hands pinch and move apart
- **THEN** the camera distance to the target decreases

#### Scenario: Midpoint move pans
- **WHEN** both hands pinch and move together to the left without changing their distance
- **THEN** the view pans to the right, the orbit target moves and the camera distance stays within 2% of its previous value

### Requirement: Two-hand turn rotates the view
While both hands pinch, turning them like a dial SHALL turn the view around the orbit target by the same angle, in the same direction. Turns smaller than 0.6 degrees per update SHALL be ignored as tracking jitter, while a slow steady turn SHALL still add up.

#### Scenario: Dial turn
- **GIVEN** both hands pinch
- **WHEN** the line between them turns by 20 degrees
- **THEN** the camera azimuth changes by 20 degrees and the camera distance is unchanged

#### Scenario: Jitter does not wobble the view
- **WHEN** the line between the pinching hands wobbles by less than 0.6 degrees per update
- **THEN** the camera azimuth does not change

### Requirement: Flicked navigation coasts to a stop
Releasing an orbit, zoom, pan or turn while the hands are still moving SHALL be a flick: the release speed, measured over the last 100 ms, SHALL keep the view moving the same way, slowing with a 320 ms time constant until it stops. A drag held still before release SHALL NOT coast. Pinching again, clicking or scrolling SHALL stop a coasting view at once. The camera SHALL ease toward each new hand position over about 100 ms so it glides between tracking frames instead of stepping.

#### Scenario: Flicked orbit coasts
- **WHEN** the user releases a fast one-hand orbit while still moving
- **THEN** the view keeps turning the same way after the release and then stops by itself

#### Scenario: Grab stops the coast
- **GIVEN** the view is coasting after a flick
- **WHEN** the user pinches again
- **THEN** the view stops coasting

### Requirement: Navigation never waits for the agent
Hand navigation SHALL be applied locally in the browser and SHALL NOT depend on the bridge or the agent being available or idle.

#### Scenario: Navigation while the bridge is down
- **GIVEN** the bridge is stopped after the scene has loaded
- **WHEN** the user pinch-drags
- **THEN** the view still orbits

### Requirement: Gesture-to-render latency is measured and bounded
The system SHALL measure the time from the capture timestamp of a frame to the render of the camera change it caused, and SHALL show its 90th percentile over the last 3 seconds in the viewer's status bar. The target for that 90th percentile is under 50 ms on a laptop with the GPU backend.

#### Scenario: Latency readout
- **WHEN** the user navigates with hands
- **THEN** the status bar shows the gesture-to-render 90th percentile in milliseconds

### Requirement: Hand pointer highlights and selects
The pinch point of the right hand, or of the only hand in view, SHALL drive an on-screen pointer, amplified by 1.3 around the image centre. The pointer SHALL be shown whenever a hand is tracked, dimmed while not engaged. While engaged and not navigating, the element under the pointer SHALL be highlighted, except under HUD panels. With Select active, a pinch tap SHALL select the highlighted element and a tap on empty space SHALL clear the selection.

#### Scenario: Tap selects the hovered element
- **GIVEN** the pointer is over a wall
- **WHEN** the user performs a pinch tap
- **THEN** that wall becomes the selection and is shown as selected

#### Scenario: Tap on empty space clears
- **GIVEN** a wall is selected
- **WHEN** the user taps with the pointer over empty sky
- **THEN** the selection becomes empty

#### Scenario: Pointer while not engaged
- **GIVEN** the system is not engaged
- **WHEN** a hand is in view
- **THEN** the pointer follows it, dimmed, and nothing is highlighted

### Requirement: The left hand gets a second pointer
With both hands in view, the left hand's pinch point SHALL get a second, light grey pointer, while hover and selection stay with the right hand.

#### Scenario: Second hand gets a grey pointer
- **GIVEN** the system is engaged and the right hand points at a block
- **WHEN** the left hand comes into view as well
- **THEN** a second, light grey pointer follows the left hand and the block under the right hand stays highlighted

### Requirement: Mouse and keyboard remain available
Mouse and keyboard navigation SHALL work at all times, including while the camera is running: left drag orbits, right or middle drag pans, the wheel zooms, and a left click acts with the active tool (with Select, it selects, and a click on empty space clears). Ctrl+Z SHALL undo and Ctrl+Shift+Z or Ctrl+Y SHALL redo one transaction, except while typing in a text field.

#### Scenario: Mouse works with tracking on
- **GIVEN** tracking is running
- **WHEN** the user drags with the mouse
- **THEN** the view orbits

#### Scenario: Keyboard undo and redo
- **GIVEN** the last transaction deleted a block
- **WHEN** the user presses Ctrl+Z and then Ctrl+Shift+Z
- **THEN** the block comes back and is then deleted again
