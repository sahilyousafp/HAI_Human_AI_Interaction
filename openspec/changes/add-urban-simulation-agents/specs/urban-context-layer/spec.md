# Spec Delta

## Purpose
Shows what the open data says about a place (buildings, trees, ground data) around the user's model without making it part of the model: seen by the user and the agents, never selected, saved or undone with the project, and brought into the model only by a decision.

## ADDED Requirements

### Requirement: Fetched context is a read-only layer
Buildings, trees and ground rasters fetched for the site SHALL be drawn in the viewer as a context layer that is not part of the project document: it SHALL NOT be selectable or editable, SHALL NOT be saved in the project's model, SHALL NOT take part in undo or in claims, and SHALL be drawn in a quiet neutral tint that is clearly different from model elements. Hand pointing and snapping SHALL ignore it. The layer SHALL be kept with the workspace so that it returns when the project is opened, and SHALL be cleared when another project is opened.

#### Scenario: Not selectable
- **GIVEN** the layer shows neighbouring buildings
- **WHEN** the user points at and pinches one
- **THEN** nothing is selected and the hand's pointer passes to the model behind it

#### Scenario: Not in the project
- **WHEN** the project is saved
- **THEN** the project's document holds no context item

#### Scenario: Another project
- **GIVEN** a layer is shown
- **WHEN** another project is opened
- **THEN** the layer is cleared

### Requirement: The layer is drawn in model coordinates from the site
Buildings SHALL be drawn as footprints extruded to their height (marked estimated where they are), trees as markers at their positions, and rasters (vegetation cover, ground temperature) as a coloured ground overlay with a legend naming the quantity, unit, source and date. Everything SHALL be placed with the project's site, and a layer built for an older site SHALL be shown as out of date.

#### Scenario: Buildings with heights
- **GIVEN** a source returns a building with a 20 m footprint edge and a height of 12 m
- **WHEN** it is added to the layer
- **THEN** it is drawn as a 12 m high prism at its place relative to the site

#### Scenario: Legend for a raster
- **WHEN** a ground temperature overlay is shown
- **THEN** a legend names the quantity, its unit, the source and the date of the scene

### Requirement: The layer can be hidden and is seen by the agents' cameras
Settings SHALL have a Show context switch (on by default) that hides the layer in the user's view. Agents' own cameras and sun studies SHALL include the layer whatever the switch says, so that shadows from neighbouring buildings are real, and the pictures SHALL show it in the same neutral tint.

#### Scenario: Hidden for the user
- **GIVEN** the layer exists
- **WHEN** the user switches Show context off
- **THEN** the user's view no longer shows it, and an agent's picture still does

#### Scenario: Shadows from neighbours
- **GIVEN** a neighbouring building stands south of the model
- **WHEN** Climate studies the sun at winter noon
- **THEN** the building's shadow falls on the model in the returned picture

### Requirement: Agents can read the layer
Agents that look at the model SHALL be able to list what the layer holds (the number of buildings, trees and rasters, the area, the source, date and attribution) and read the items in an area, with their positions in model millimetres and heights. A request for more than the size limit SHALL return the nearest items and say it was cut short.

#### Scenario: A summary
- **GIVEN** the layer holds 240 buildings and one raster
- **WHEN** an agent asks what the layer holds
- **THEN** it receives those counts with the sources and dates

#### Scenario: Cut short
- **WHEN** an agent asks for every item and the layer holds more than the limit
- **THEN** the nearest items are returned with a note that the rest were left out

### Requirement: Writers adopt items into the model by a decision
An agent that changes the model SHALL be able to adopt chosen items of the layer into the project: each becomes an ordinary element (a building's footprint extruded to its height) that is owned by that agent, tagged with its source, and created inside the agent's claim and as one undo step. The layer SHALL keep its own copy. Agents that do not change the model SHALL NOT be able to adopt.

#### Scenario: Adopt a neighbour
- **WHEN** Architect adopts one neighbouring building
- **THEN** an element of that footprint extruded to its height is added to the model, tagged with its source, and one undo removes it

#### Scenario: A reader cannot adopt
- **WHEN** Urban tries to adopt an item
- **THEN** the call is refused, because the app's tool server offers it no such tool, and the model is unchanged

#### Scenario: Outside the claim
- **GIVEN** Architect holds a claim for the part "pavilion" with a region
- **WHEN** it adopts a building outside that region
- **THEN** the call is refused with the claim rule and nothing is added
