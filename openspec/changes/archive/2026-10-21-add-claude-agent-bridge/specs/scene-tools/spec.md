# Spec Delta

## Purpose

Gives the agent a precise, validated way to read and change the shared architectural scene, so that everything it does is visible, consistent and undoable.

## ADDED Requirements

### Requirement: Agent can read the scene
The scene tools SHALL let the agent get a compact scene summary (levels, element counts by type, bounding box), get full details for elements by id or by type and level, and read the current selection.

#### Scenario: Summary of the sample scene
- **WHEN** the agent calls the summary tool on the sample scene
- **THEN** it receives the levels, the count of each element type and the overall bounding box in millimetres

### Requirement: Agent can read what the user is pointing at
The scene tools SHALL let the agent read the user context: the current selection, the element under the hand pointer if any, and the current camera.

#### Scenario: Pointed element reported
- **GIVEN** the hand pointer is over a column
- **WHEN** the agent reads the user context
- **THEN** the column's id is reported as the pointed element

### Requirement: Agent can create, update and delete elements
The scene tools SHALL let the agent create, update and delete elements in batches, and set the selection for everyone. Every input SHALL be validated against the scene schema, and an invalid batch SHALL change nothing and return an error that names the invalid element and field.

#### Scenario: Invalid batch is atomic
- **WHEN** the agent submits a batch of three walls where one has zero height
- **THEN** no wall is created and the error names the invalid wall and the height field

### Requirement: One agent turn is one undoable transaction
All scene changes made during one agent turn SHALL form a single transaction labelled with what the turn was asked to do, so a single undo reverts the whole turn. The user SHALL see each change in the model as it is made.

#### Scenario: Undo a whole turn
- **GIVEN** an agent turn that created four columns and moved a wall
- **WHEN** the user presses undo once
- **THEN** the four columns are removed and the wall returns to its previous position

### Requirement: Agent can see the view
The scene tools SHALL let the agent request an image of the current viewer, returned as a PNG no larger than 1280 pixels on its longest side.

#### Scenario: Capture view
- **WHEN** the agent calls the capture tool while the viewer is open
- **THEN** it receives a PNG image of the current view

#### Scenario: No viewer open
- **WHEN** the agent calls the capture tool and no viewer is connected
- **THEN** it receives an error stating that no viewer is open
