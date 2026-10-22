# scene-model Specification

## Purpose
Defines the shared architectural model that the viewer displays, the user selects from and the agent edits, so every part of the system works on one consistent, undoable source of truth.

## Requirements

### Requirement: Scene uses millimetres and a Z-up axis
The scene SHALL store all lengths in millimetres and SHALL use a right-handed coordinate system with Z pointing up, matching Rhino's convention. An element's base SHALL sit at the elevation of its level.

#### Scenario: Round trip keeps units
- **WHEN** a wall 300 mm thick is saved and reloaded
- **THEN** its thickness reads 300 and its base sits at its level's elevation on Z

### Requirement: Scene supports basic architectural elements
The scene SHALL support element types massing, slab, wall and column, each with a stable unique id, a name, an optional level, type-specific dimensions and free-form properties. Loading SHALL reject a scene whose elements have invalid dimensions, refer to a level that does not exist, or are stored under a key that differs from their id.

#### Scenario: Element types load
- **WHEN** the sample scene is loaded
- **THEN** it contains at least one element of each type, each with a unique id

#### Scenario: Invalid element is rejected
- **WHEN** a scene file contains a wall with a negative thickness
- **THEN** loading fails with an error naming the element id and the invalid field, and the current scene is unchanged

### Requirement: Scene persists to a project file
The system SHALL load the scene from and save it to `scene.hai.json` in a project folder chosen by the user, and SHALL save automatically within 2 seconds of the last change. A folder without a scene file SHALL start from the sample scene. The last project opened SHALL be reopened on the next start; with none remembered, a copy of the sample scene in the workspace SHALL be opened. The viewer SHALL show the open project's name and save state.

#### Scenario: Autosave
- **GIVEN** a project folder is open
- **WHEN** an element is changed and 2 seconds pass
- **THEN** the project file on disk contains the change

#### Scenario: Empty folder starts from the sample
- **WHEN** the user opens a folder that has no scene file
- **THEN** the sample scene is loaded, written to that folder, and sent to every connected client

#### Scenario: Last project reopens
- **GIVEN** the user opened a project folder
- **WHEN** the bridge restarts
- **THEN** the same project folder is open

### Requirement: All edits are undoable transactions
Every change to the scene SHALL happen inside a transaction with a label. A transaction SHALL apply completely or not at all. Undo SHALL revert a whole transaction and redo SHALL reapply it; a new transaction SHALL clear redo.

#### Scenario: Multi-element transaction undoes at once
- **GIVEN** one transaction that moves three columns
- **WHEN** the user undoes once
- **THEN** all three columns return to their previous positions

#### Scenario: Invalid transaction changes nothing
- **WHEN** a client sends a transaction with an invalid operation
- **THEN** the scene is unchanged, no client receives a change, and only the sender receives an error

### Requirement: One authoritative scene shared by all clients
The bridge SHALL hold the authoritative scene. Every connected client SHALL receive a snapshot on connect and every later change as a patch with an increasing sequence number, so all clients converge to the same state. A client SHALL be able to ask for a fresh snapshot at any time.

#### Scenario: Two clients stay in sync
- **GIVEN** two browser tabs connected to the bridge
- **WHEN** one tab deletes an element
- **THEN** the element disappears in the other tab within 200 ms

### Requirement: Selection is part of the shared state
The current selection SHALL be held by the bridge and sent to every client when it changes, so that any client and the agent can read what the user has selected. Ids of elements that do not exist SHALL be ignored, and a deleted element SHALL drop out of the selection.

#### Scenario: Selection visible to other clients
- **WHEN** the user selects a wall in one tab
- **THEN** every other connected client receives that wall's id as the selection

#### Scenario: Deleting a selected element clears it from the selection
- **GIVEN** a column is selected
- **WHEN** the column is deleted
- **THEN** the selection becomes empty for every client
