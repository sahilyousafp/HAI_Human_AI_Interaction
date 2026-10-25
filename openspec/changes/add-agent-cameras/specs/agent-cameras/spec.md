# Spec Delta

## ADDED Requirements

### Requirement: Agents have private cameras
An agent SHALL be able to place, list, move and delete named cameras of its own, each given by a direction (azimuth and elevation), a distance and a target, or by elements to frame. An agent's cameras SHALL belong to that agent only: other agents SHALL NOT see or change them, and placing or moving one SHALL NOT change the user's camera or any other part of what the user sees. An agent's cameras SHALL be removed when its task ends.

#### Scenario: Place a camera
- **WHEN** Architect places a camera named `south` looking at the dome from the south at 30 degrees
- **THEN** the camera exists for Architect, `camera_list` shows it, and the user's view has not moved

#### Scenario: Cameras are private
- **GIVEN** Architect has a camera named `south`
- **WHEN** Product lists its cameras
- **THEN** Product sees none, and Product can place its own camera named `south`

#### Scenario: Cameras end with the task
- **GIVEN** Architect has two cameras
- **WHEN** Architect's task ends
- **THEN** both cameras are gone

### Requirement: Agents take pictures from their cameras
An agent SHALL be able to get a PNG picture from any of its cameras, no larger than 1280 pixels on its longest side. A picture SHALL show the model as it is, including each owner's tint, and SHALL NOT show the user's hover, selection, deletion marks, section cut or hand pointers unless the agent asks for them. Taking a picture SHALL NOT change what the user sees, even for a moment, and SHALL NOT use the user's camera. An agent SHALL be able to ask for several cameras at once, or for a preset: `iso` (four corners), `top`, `front`, `left`, or `orbit-sheet` (eight views around the model), each framed on the model or on elements it names.

#### Scenario: A picture from a private camera
- **GIVEN** the user is orbiting the model
- **WHEN** Architect captures from its camera `south`
- **THEN** Architect receives a picture from `south`, and the user's camera, selection and canvas are unchanged

#### Scenario: The user's state stays out of the picture
- **GIVEN** the user has selected a wall and is pointing at a column
- **WHEN** an agent captures with a camera
- **THEN** neither the wall nor the column is drawn as selected or hovered

#### Scenario: A preset
- **WHEN** an agent captures the `orbit-sheet` preset
- **THEN** it receives eight pictures taken around the model, each marked with its direction

#### Scenario: Two agents at once
- **WHEN** Architect and Product capture at the same time
- **THEN** each receives a picture from its own camera

#### Scenario: No viewer open
- **WHEN** an agent captures and no viewer is connected
- **THEN** it receives an error stating that no viewer is open

### Requirement: A capture goes to one viewer
A request for a picture SHALL name the agent that asked and SHALL be answered by one viewer, the one the user used most recently, instead of every open viewer. If that viewer does not answer within 5 seconds the request SHALL fail with a message saying so.

#### Scenario: Two viewers open
- **GIVEN** two viewer windows are open
- **WHEN** an agent captures
- **THEN** one window renders the picture and the other does no work

### Requirement: The user can see what agents look at
The agent panel SHALL show the last picture each agent took, as a small thumbnail on the agent's chip with the camera's name, and the user SHALL be able to enlarge it. The model MAY show each agent camera as a small marker in the agent's colour; a setting in Settings > Modelling SHALL turn the markers off. Markers and thumbnails SHALL never take pointer or hand input away from the model.

#### Scenario: Thumbnail
- **WHEN** Architect has captured from `south`
- **THEN** its chip shows a thumbnail marked `south`, and clicking it shows the picture larger

#### Scenario: Markers off
- **GIVEN** Architect has two cameras and markers are on
- **WHEN** the user turns the markers off in Settings > Modelling
- **THEN** no markers are drawn and the thumbnails remain
