# Spec Delta

## Purpose
Gives the team a specialist for how a design behaves (sun, heat, daylight, energy), working from the user's own Ladybug Tools installation and from open data about the ground, and saying plainly how old its data is and how its numbers were made.

## ADDED Requirements

### Requirement: Simulation is a specialist that reads, never changes the model
The default team SHALL include Simulation, an agent for performance studies with its own colour that is clearly distinct from the other agents' colours in both themes, and with the speech names "simulation", "simulator", "sim" and "ladybug". Simulation SHALL be able to read the model, look through its own cameras, run sun studies, offer information panels, read the context layer and use the weather and surface-temperature tools. Simulation SHALL NOT be able to change the model, whatever its definition lists.

#### Scenario: Simulation exists
- **GIVEN** a project without agent definitions
- **WHEN** the first request is sent
- **THEN** a definition for simulation exists in the project, and the team strip shows Simulation in its own colour

#### Scenario: Simulation cannot edit
- **WHEN** Simulation tries to create, update or delete an element
- **THEN** the call is refused, because the app's tool server offers Simulation no tools that change the model, and the model is unchanged

### Requirement: Ladybug Tools is the user's own installation
The system SHALL NOT include, bundle, download or link Ladybug Tools, its MCP server or the engines they use. Ladybug Tools MCP SHALL be offered in the Extensions tab as an entry the user installs, showing before anything runs that it is GPL-3.0 software run as a separate program, the command that will be run, what it needs (Python 3.12 through uv, a large first download, the simulation engines it uses, Windows as its main platform) and that it is experimental. It SHALL be installed only when the user confirms, through the same flow as any extension, and removed the same way. The system SHALL talk to it only over the Model Context Protocol, as to any other extension.

#### Scenario: The entry shows the licence
- **WHEN** the user opens the Ladybug Tools entry in Extensions
- **THEN** it shows the licence, the command, the requirements and the warning that it is experimental, and nothing is installed yet

#### Scenario: Installed on confirmation
- **WHEN** the user confirms the install
- **THEN** the server is added to the project as an extension and Simulation's next request can use its tools

#### Scenario: Never installed by the app on its own
- **WHEN** Simulation is used and the user has not installed Ladybug Tools
- **THEN** nothing is downloaded or run for Ladybug Tools

### Requirement: Simulation uses Ladybug when it is there and says so when it is not
Simulation's tools SHALL include the installed Ladybug server's tools. Each use SHALL ask for approval like any other extension tool. When the server is not installed or does not start, Simulation SHALL say so, say how to install it, and still answer with what it can do without it (sun and shadow, weather and ground temperature), saying that the result is not a simulation of the building's energy or daylight.

#### Scenario: Ladybug installed
- **GIVEN** the user installed Ladybug Tools MCP
- **WHEN** Simulation runs an analysis through it
- **THEN** each Ladybug tool call shows an approval card, and the result is reported with the weather file and settings used

#### Scenario: Ladybug missing
- **GIVEN** Ladybug Tools MCP is not installed
- **WHEN** the user asks Simulation for a daylight study
- **THEN** Simulation says it needs Ladybug Tools MCP, says how to install it from Extensions, and offers a sun study instead

### Requirement: The model reaches the simulation as a simplified massing
Simulation SHALL be able to get the model, and optionally the context layer, as a simplified description in metres with +Z up (footprints with heights, levels, and openings where the model has them), so that it can build the simulation's own model from it. The description SHALL say what was simplified and left out, and it SHALL leave nothing out silently.

#### Scenario: A massing description
- **GIVEN** the model has two walls and a slab
- **WHEN** Simulation asks for the simulation geometry
- **THEN** it receives the elements in metres with their heights and a list of what was simplified

#### Scenario: Context included
- **WHEN** Simulation asks for the geometry with the neighbouring buildings
- **THEN** the buildings of the context layer are included as shading objects and are marked as context

### Requirement: Simulation reads the ground's temperature, and says how old it is
Simulation SHALL be able to get the land surface temperature around the site from the latest cloud-free open satellite scene, as statistics for an area (minimum, mean, maximum and the share of the area above a threshold the agent names) and as an overlay in the context layer with a legend. Each answer SHALL give the scene's date, its age, the sensor and the resolution, SHALL be marked as surface (not air) temperature, and SHALL state that a satellite scene is a moment in the past, not live data. When there is no suitable scene within a limit the agent names, Simulation SHALL be told so and SHALL NOT receive an invented value.

#### Scenario: Latest scene
- **GIVEN** Open data is on and the site is set
- **WHEN** Simulation asks for the surface temperature within 300 m
- **THEN** it receives the statistics with the scene's date and age, the sensor and its resolution, and an overlay appears in the context layer

#### Scenario: No scene
- **WHEN** no cloud-free scene exists within the limit
- **THEN** Simulation is told so, with the date of the last scene seen, and receives no values

#### Scenario: Surface is not air
- **WHEN** Simulation reports the result
- **THEN** its report says it is the temperature of the ground and roofs seen from above, not of the air

### Requirement: Simulation reports method, data and age, not a verdict
Simulation's instructions SHALL tell it to give the weather file or data, its date and age, the settings and the engine used, to give ranges where the method has them, to say what it did not model, and never to call a result compliant or certified. A comparison or a table SHALL be shown in an information panel when it is easier to see than to read.

#### Scenario: Report content
- **WHEN** Simulation reports a daylight result
- **THEN** its answer names the weather data, the settings and the limits of the study, and does not claim compliance

#### Scenario: A table in a panel
- **WHEN** Simulation compares three roof options
- **THEN** it can show the comparison in an information panel that cannot change the model
