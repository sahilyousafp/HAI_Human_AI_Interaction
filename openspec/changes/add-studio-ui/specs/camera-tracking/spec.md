## MODIFIED Requirements

### Requirement: Camera preview can be expanded
The camera preview SHALL be shown in a camera view floating at the model's bottom right, with Start / Stop camera, whether the user is engaged, each hand's state and detection rate, and the last gesture. The user SHALL be able to expand the view over the model and shrink it back, and to hide it into a small Camera pill and show it again. Both choices SHALL be remembered in this browser. The camera SHALL keep running and tracking whatever the view shows: expanded, hidden, or with the settings open or closed.

#### Scenario: Expanded preview is remembered
- **WHEN** the user expands the camera view and reloads the page
- **THEN** the view is still expanded over the model, and the same control shrinks it back to the bottom right

#### Scenario: Hidden, still tracking
- **GIVEN** the camera is running
- **WHEN** the user hides the camera view
- **THEN** a Camera pill shows instead, tracking frames keep arriving, and pressing the pill brings the view back

#### Scenario: Settings do not stop the camera
- **GIVEN** the camera is running
- **WHEN** the user opens and closes the settings
- **THEN** tracking frames keep arriving and the header still shows Camera on
