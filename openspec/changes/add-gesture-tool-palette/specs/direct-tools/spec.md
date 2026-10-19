# Spec Delta

## Purpose

Defines the built-in design tools the user drives directly with hands, mouse or keyboard, so common actions never need the agent.

## ADDED Requirements

### Requirement: Select is the default tool
Select SHALL be active on start. In Select, tap selects and tap on empty space clears, as defined by viewport navigation.

#### Scenario: Default tool on start
- **WHEN** the app starts
- **THEN** the active tool is Select

### Requirement: Move drags elements on the ground plane with snapping
With Move active, a pinch drag that starts on an element SHALL move it parallel to the ground plane, snapping to 100 mm increments, and SHALL commit one transaction labelled "Move" on release.

#### Scenario: Snapped move
- **GIVEN** Move is active and the pointer is over a massing block
- **WHEN** the user drags it about 1.23 m east and releases
- **THEN** the block's origin changes by 1200 mm on X and one "Move" transaction is added

#### Scenario: Drag on empty space orbits
- **WHEN** a drag starts on empty space with Move active
- **THEN** the view orbits instead and the scene is unchanged

### Requirement: Measure reports distances in millimetres
With Measure active, two taps on scene surfaces SHALL show the straight-line distance between the picked points in millimetres, rounded to 1 mm, until the next measurement or a tool change. Measuring SHALL NOT change the scene.

#### Scenario: Measure a wall
- **WHEN** the user taps both ends of a 6000 mm wall face
- **THEN** a label reading 6000 mm, within 1% tolerance for the picked points, is shown and the scene is unchanged

### Requirement: Section clips the view by hand height
With Section active, the section plane SHALL be shown as a plane that highlights under the pointer, and a vertical pinch drag that starts on it SHALL move it through the model, hiding geometry above it (a drag that starts off the plane orbits the view). The plane height SHALL be shown in millimetres. Leaving the tool SHALL keep the section until it is cleared from the HUD.

#### Scenario: Lower the section
- **WHEN** the user pinch-drags the section plane downward with Section active
- **THEN** the section plane height decreases and geometry above it is hidden

### Requirement: Add massing places a block
With Add massing active, a tap on the ground SHALL create a 6000 x 6000 x 3500 mm massing block centred on the tapped point, snapped to 100 mm, in one transaction labelled "Add massing".

#### Scenario: Place a block
- **WHEN** the user taps the ground with Add massing active
- **THEN** a new massing block of 6000 x 6000 x 3500 mm appears at the snapped tap point

### Requirement: Delete asks for confirmation
With Delete active, a tap on an element SHALL mark it for deletion and ask for confirmation. A nod or Enter SHALL delete it in one transaction labelled "Delete". A shake or Escape SHALL cancel.

#### Scenario: Confirm with nod
- **GIVEN** an element is marked for deletion
- **WHEN** the user nods
- **THEN** the element is deleted

#### Scenario: Cancel with shake
- **GIVEN** an element is marked for deletion
- **WHEN** the user shakes their head
- **THEN** nothing is deleted

### Requirement: Undo and Redo act immediately
Choosing Undo or Redo in the palette SHALL undo or redo one transaction immediately and leave the previous tool active. After an undo or redo, the HUD SHALL offer Undo again and Redo controls for a few seconds, so several transactions can be undone in a row.

#### Scenario: Undo from the palette
- **GIVEN** Move is active and the last transaction moved a block
- **WHEN** the user chooses Undo from the palette
- **THEN** the block returns to its previous position and Move is still active

#### Scenario: Undo several changes
- **GIVEN** the last two transactions renamed a block twice
- **WHEN** the user undoes once and then taps Undo again
- **THEN** both renames are undone

### Requirement: Ask agent opens the agent input
Choosing Ask agent SHALL focus the agent request input, so the user can type or, once voice exists, speak. When no agent is available it SHALL say why.

#### Scenario: No agent yet
- **WHEN** the user chooses Ask agent and no agent session is available
- **THEN** a message explains that the agent is not connected
