# Spec Delta

## ADDED Requirements

### Requirement: User context includes Rhino when it is connected
While Rhino is connected and the modelling mode is not Python only, the user context tool SHALL report the Rhino object under the hand pointer in the viewer, the Rhino selection (object ids with object type and layer), so the agent can pass those ids to Rhino tools.

#### Scenario: "This" in Rhino
- **GIVEN** Rhino is connected and the pointer is over a mirrored Brep on layer "Facade"
- **WHEN** the agent reads the user context
- **THEN** it receives that Brep's Rhino object id, its type and the layer "Facade"

### Requirement: The agent can set the view
A `set_view` tool SHALL let the agent change the viewer's camera: its azimuth, elevation and distance, a target point, or elements to frame. The view SHALL animate to the requested one, SHALL NOT change the scene, and SHALL give way at once to the user's own navigation.

#### Scenario: Show it from the south-west
- **WHEN** the agent calls `set_view` with azimuth 225 degrees
- **THEN** the viewer turns to look from the south-west within a second

#### Scenario: Frame elements
- **WHEN** the agent calls `set_view` with two element ids
- **THEN** the view frames both

#### Scenario: The user takes over
- **GIVEN** the view is animating to the agent's request
- **WHEN** the user orbits by hand
- **THEN** the animation stops and the user's orbit continues from where the view is
