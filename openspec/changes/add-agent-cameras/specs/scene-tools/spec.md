# Spec Delta

## MODIFIED Requirements

### Requirement: Agent can see the view
The scene tools SHALL let the agent request an image of what the user currently sees in the viewer, returned as a PNG no larger than 1280 pixels on its longest side, and SHALL describe it as the user's own view. The scene tools SHALL also let the agent move the user's camera only when it is asked to show the user something. An agent that is checking its own work SHALL use its own cameras instead, so the user's view is not disturbed. A sun study SHALL take its pictures with its own light and SHALL NOT change the light the user sees.

#### Scenario: Capture view
- **WHEN** the agent calls the capture tool while the viewer is open
- **THEN** it receives a PNG image of the current view

#### Scenario: No viewer open
- **WHEN** the agent calls the capture tool and no viewer is connected
- **THEN** it receives an error stating that no viewer is open

#### Scenario: Sun study leaves the light alone
- **GIVEN** the user is looking at the model in the viewer's own light
- **WHEN** an agent runs a sun study
- **THEN** the pictures show the sun's light and the user's light is unchanged throughout
