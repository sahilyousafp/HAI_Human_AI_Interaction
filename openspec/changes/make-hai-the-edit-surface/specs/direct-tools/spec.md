# Spec Delta

## REMOVED Requirements

### Requirement: Add massing places a block
**Reason**: HAI does not model; the host applications do (`pivot-to-host-orchestration`).
**Migration**: Ask the agent for a massing in a host, or sketch an area and ask "a massing here".

## ADDED Requirements

### Requirement: The rings hold no creation tool
The edit ring SHALL hold Select, Move, Rotate, Delete, Undo, Redo, Measure and Section, and the reference ring Line sketch, Area sketch, Marker, Lasso and Ask agent. No tool SHALL create building geometry in HAI's scene. A saved layout naming a removed tool SHALL have that slot emptied.

#### Scenario: The default rings
- **WHEN** the default rings are shown
- **THEN** neither offers wall, slab, column, copy, massing or line

#### Scenario: A saved layout with a removed tool
- **GIVEN** a saved edit ring holding "wall" in its sixth slot
- **WHEN** the settings are read
- **THEN** the sixth slot is empty and the other tools stay where they were

### Requirement: Spoken commands do not create geometry
Spoken "copy", "array" and "scale" SHALL NOT be commands. Spoken "move", "rotate" and "delete" SHALL act on host objects as on scene elements.

#### Scenario: A removed command
- **WHEN** the user says "array 5 times"
- **THEN** nothing is changed and the reply says arrays are made by asking the agent

#### Scenario: A spoken move on a host object
- **GIVEN** a Rhino object is selected
- **WHEN** the user says "move this 2 metres to the right"
- **THEN** Rhino receives one transform of 2000 mm along x
