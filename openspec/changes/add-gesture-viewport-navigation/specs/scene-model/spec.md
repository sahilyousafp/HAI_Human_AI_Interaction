# Spec Delta

## Purpose

Defines the shared architectural model that the viewer displays, the user selects from and the agent edits, so every part of the system works on one consistent, undoable source of truth.

## ADDED Requirements

### Requirement: Scene uses millimetres and a Z-up axis
The scene SHALL store all lengths in millimetres and SHALL use a right-handed coordinate system with Z pointing up, matching Rhino's convention.

#### Scenario: Round trip keeps units
- **WHEN** a wall 300 mm thick is saved and reloaded
- **THEN** its thickness reads 300 and its base sits at its level's elevation on Z

### Requirement: Scene supports basic architectural elements
The scene SHALL support element types massing, slab, wall and column, each with a stable unique id, a name, an optional level, type-specific dimensions and free-form properties.

#### Scenario: Element types load
- **WHEN** the sample scene is loaded
- **THEN** it contains at least one element of each type, each with a unique id

#### Scenario: Invalid element is rejected
- **WHEN** a scene file contains a wall with a negative thickness
- **THEN** loading fails with an error naming the element id and the invalid field, and the current scene is unchanged

### Requirement: Scene persists to a project file
The system SHALL load the scene from and save it to a JSON file in a project folder chosen by the user, and SHALL save automatically within 2 seconds of the last change.

#### Scenario: Autosave
- **GIVEN** a project folder is open
- **WHEN** an element is changed and 2 seconds pass
- **THEN** the project file on disk contains the change

### Requirement: All edits are undoable transactions
Every change to the scene SHALL happen inside a transaction with a label. Undo SHALL revert a whole transaction and redo SHALL reapply it.

#### Scenario: Multi-element transaction undoes at once
- **GIVEN** one transaction that moves three columns
- **WHEN** the user undoes once
- **THEN** all three columns return to their previous positions

### Requirement: One authoritative scene shared by all clients
The bridge SHALL hold the authoritative scene. Every connected client SHALL receive a snapshot on connect and every later change as an ordered patch, so all clients converge to the same state.

#### Scenario: Two clients stay in sync
- **GIVEN** two browser tabs connected to the bridge
- **WHEN** one tab deletes an element
- **THEN** the element disappears in the other tab within 200 ms

### Requirement: Selection is part of the shared state
The current selection SHALL be held by the bridge, so that any client and the agent can read what the user has selected.

#### Scenario: Selection visible to other clients
- **WHEN** the user selects a wall in one tab
- **THEN** the bridge reports that wall's id as the selection to any client that asks
