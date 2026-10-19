# Spec Delta

## Purpose

Lets the user move around the model and point at and select elements with their hands, while mouse and keyboard keep working, in the built-in viewer.

## ADDED Requirements

### Requirement: One-hand pinch-drag orbits the view
While engaged, a one-hand pinch drag SHALL orbit the camera around the current orbit target: horizontal hand motion changes azimuth around the Z axis, vertical motion changes elevation, and elevation SHALL stay between 5 and 89 degrees.

#### Scenario: Drag right orbits
- **GIVEN** the system is engaged
- **WHEN** the user pinch-drags to the right by 20% of the image width
- **THEN** the camera azimuth changes by a negative amount (the model turns as if dragged with the mouse) and the orbit target does not move

#### Scenario: Elevation is clamped
- **WHEN** the user drags far enough to exceed 89 degrees elevation
- **THEN** the elevation stops at 89 degrees

### Requirement: Two-hand pinch zooms and pans
While both hands pinch, increasing the distance between them SHALL zoom in, decreasing it SHALL zoom out, and moving their midpoint SHALL pan the view parallel to the screen.

#### Scenario: Spread zooms in
- **WHEN** both hands pinch and move apart
- **THEN** the camera distance to the target decreases

#### Scenario: Midpoint move pans
- **WHEN** both hands pinch and move together to the left without changing their distance
- **THEN** the orbit target moves and the camera distance stays within 2% of its previous value

### Requirement: Navigation never waits for the agent
Hand navigation SHALL be applied locally in the browser and SHALL NOT depend on the bridge or the agent being available or idle.

#### Scenario: Navigation while the bridge is down
- **GIVEN** the bridge is stopped after the scene has loaded
- **WHEN** the user pinch-drags
- **THEN** the view still orbits

### Requirement: Gesture-to-render latency is measured and bounded
The system SHALL measure the time from the capture timestamp of a frame to the render of the camera change it caused, show it on the HUD, and keep its 90th percentile under 50 ms on the reference laptop with the GPU backend.

#### Scenario: Latency readout
- **WHEN** the user navigates with hands
- **THEN** the HUD shows the current gesture-to-render latency and its 90th percentile

### Requirement: Hand pointer highlights and selects
While engaged and not navigating, the pinch point SHALL drive an on-screen pointer. The element under the pointer SHALL be highlighted. A pinch tap SHALL select that element, and a tap on empty space SHALL clear the selection.

#### Scenario: Tap selects the hovered element
- **GIVEN** the pointer is over a wall
- **WHEN** the user performs a pinch tap
- **THEN** that wall becomes the selection and is shown as selected

#### Scenario: Tap on empty space clears
- **GIVEN** a wall is selected
- **WHEN** the user taps with the pointer over empty sky
- **THEN** the selection becomes empty

### Requirement: Mouse and keyboard remain available
Mouse orbit, pan, zoom, click-to-select and keyboard undo and redo SHALL work at all times, including while the camera is running.

#### Scenario: Mouse works with tracking on
- **GIVEN** tracking is running
- **WHEN** the user drags with the mouse
- **THEN** the view orbits
