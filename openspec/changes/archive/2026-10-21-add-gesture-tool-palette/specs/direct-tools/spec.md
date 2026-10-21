# Spec Delta

## Purpose

Defines the built-in design tools the user drives directly with hands, mouse or keyboard, so common actions never need the agent.

## ADDED Requirements

### Requirement: Select is the default tool
Select SHALL be active on start. In Select, a tap or click selects the element under the pointer, a tap on empty space clears the selection, as defined by viewport navigation, and drags orbit the view.

#### Scenario: Default tool on start
- **WHEN** the app starts
- **THEN** the active tool is Select

### Requirement: Move drags elements on the ground plane with snapping
With Move active, a pinch or mouse drag that starts on an element SHALL move it parallel to the ground plane, previewing the move while dragging, snapping to 100 mm increments, and SHALL commit one transaction labelled "Move" on release. A drag that is cancelled (the palette opens or the user disengages) SHALL commit nothing.

#### Scenario: Snapped move
- **GIVEN** Move is active and the pointer is over a massing block
- **WHEN** the user drags it about 1.23 m east and releases
- **THEN** the block's origin changes by 1200 mm on X and one "Move" transaction is added

#### Scenario: Drag on empty space orbits
- **WHEN** a drag starts on empty space with Move active
- **THEN** the view orbits instead and the scene is unchanged

### Requirement: Measure reports distances in millimetres
With Measure active, two taps on the model SHALL show the straight-line distance between the picked points in millimetres, rounded to 1 mm. The result SHALL stay until the next tap, which starts a new measurement, or a tool change. A tap off the model SHALL ask the user to tap on the model. Measuring SHALL NOT change the scene.

#### Scenario: Measure a wall
- **WHEN** the user taps both ends of a 6000 mm wall face
- **THEN** a label reading 6000 mm, within 1% tolerance for the picked points, is shown and the scene is unchanged

### Requirement: Section clips the view by hand height
Activating Section with no section SHALL place a section plane, 1 m wider than the model, at its top; the plane SHALL highlight under the pointer. A vertical drag that starts on it SHALL move it within the model's height in 10 mm steps, hiding geometry above it; a drag off it SHALL orbit. Its height SHALL be shown in millimetres. The section SHALL stay after a tool change until removed with the HUD's Remove control or with Delete.

#### Scenario: Lower the section
- **WHEN** the user pinch-drags the section plane downward with Section active
- **THEN** the section plane height decreases and geometry above it is hidden

#### Scenario: Section stays after a tool change
- **GIVEN** a section exists
- **WHEN** the user switches to another tool
- **THEN** the section and its height readout remain until the user presses Remove

### Requirement: The section line can be grabbed from any tool
While a section exists, its outline SHALL highlight under the pointer whatever tool is active; a drag that starts on it SHALL activate the Section tool and move the section, and a tap on it SHALL select the Section tool (with Delete active, the tap removes the section instead).

#### Scenario: Grab the section line from another tool
- **GIVEN** a section exists and Select is active
- **WHEN** the user pinch-drags the section's outline downward
- **THEN** the section plane height decreases

#### Scenario: Tap the section line to select the section
- **GIVEN** a section exists and Move is active
- **WHEN** the user taps the section's outline
- **THEN** Section becomes the active tool

### Requirement: Add massing places a block
With Add massing active, a tap on the ground SHALL create a 6000 x 6000 x 3500 mm massing block centred on the tapped point, snapped to 100 mm, on the ground level, in one transaction labelled "Add massing".

#### Scenario: Place a block
- **WHEN** the user taps the ground with Add massing active
- **THEN** a new massing block of 6000 x 6000 x 3500 mm appears at the snapped tap point

### Requirement: Delete asks for confirmation
With Delete active, a tap on an element SHALL mark it in red for deletion and ask for confirmation with Delete and Keep buttons. A nod, Enter or the Delete button SHALL delete it in one transaction labelled "Delete". A shake, Escape or the Keep button SHALL cancel. A tap on the section plane or its outline SHALL remove the section without asking, since it is not part of the model.

#### Scenario: Confirm with nod
- **GIVEN** an element is marked for deletion
- **WHEN** the user nods
- **THEN** the element is deleted

#### Scenario: Cancel with shake
- **GIVEN** an element is marked for deletion
- **WHEN** the user shakes their head
- **THEN** nothing is deleted

#### Scenario: Confirm with Enter, cancel with Escape
- **GIVEN** an element is marked for deletion
- **WHEN** the user presses Escape, taps the element again and presses Enter
- **THEN** the first confirmation keeps the element and the second deletes it

#### Scenario: Delete removes the section
- **GIVEN** a section exists and Delete is active
- **WHEN** the user taps the section plane
- **THEN** the section is removed and the scene is unchanged

### Requirement: Undo and Redo act immediately
Choosing Undo or Redo in the palette or by shortcut SHALL undo or redo one transaction immediately and leave the previous tool active. After an undo or redo, the viewer SHALL show for 6 seconds what was undone or redone, with Undo again and Redo controls, so several transactions can be undone in a row.

#### Scenario: Undo from the palette
- **GIVEN** Move is active and the last transaction moved a block
- **WHEN** the user chooses Undo from the palette
- **THEN** the block returns to its previous position and Move is still active

#### Scenario: Undo several changes
- **GIVEN** the last two transactions renamed a block twice
- **WHEN** the user undoes once and then taps Undo again
- **THEN** both renames are undone

### Requirement: Ask agent opens the agent input
Choosing Ask agent SHALL open the agent panel on its conversation and start listening for a spoken request, without moving the keyboard focus, and SHALL leave the previous tool active. When the bridge is offline or no agent is available it SHALL say why instead.

#### Scenario: No agent yet
- **WHEN** the user chooses Ask agent and no agent session is available
- **THEN** a message explains why the agent is not available, the microphone stays off and the active tool is unchanged
