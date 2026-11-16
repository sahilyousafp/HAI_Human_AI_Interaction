# Spec Delta

## Purpose

The user edits a host's objects in HAI with the same tools and gestures as HAI's own elements; the host that owns them applies each edit as one undo step, and HAI's Undo follows the order of the user's edits wherever they were made.

## ADDED Requirements

### Requirement: Move, Rotate and Delete act on host objects
The Move, Rotate and Delete tools SHALL act on mirrored host objects as they do on scene elements: a drag that starts on a selected host object carries the whole selection. The edit SHALL be sent to the host that owns the objects as one transform or delete by ids, in millimetres, and the host SHALL apply it as one undo record.

#### Scenario: Move a host object by hand
- **GIVEN** a fake Rhino host with one mirrored object selected
- **WHEN** the user drags it 2000 mm along x with the Move tool
- **THEN** the host receives one transform of that object by 2000 mm along x, labelled "Move"

#### Scenario: Rotate a host object
- **WHEN** the user turns a selected host object by 30 degrees with the Rotate tool
- **THEN** the host receives one transform that turns it 30 degrees about the centre of its box in plan

#### Scenario: Delete a host object
- **WHEN** the user deletes a selected host object and confirms
- **THEN** the host receives one delete of that object

### Requirement: An edit is previewed until the host has applied it
While a host edit is dragged and until the host's own batch with the edited objects arrives, HAI SHALL draw those objects at their edited place. If the host refuses the edit or does not answer within 5 seconds, HAI SHALL draw them where the host has them and say why.

#### Scenario: No jump back
- **GIVEN** a host object moved by hand and released
- **WHEN** the host has not yet sent its batch
- **THEN** the object is drawn at its new place

#### Scenario: A refused edit
- **WHEN** the host answers the edit with an error
- **THEN** the object is drawn where it was and a notice gives the host's reason

### Requirement: Undo follows the user's own edits across HAI and the hosts
Undo SHALL take back the user's most recent edit, whether it was made on a scene element or on a host object; for a host edit it SHALL ask that host to undo. Redo SHALL redo it in the same place. An agent's run SHALL NOT be undone by Undo.

#### Scenario: Undo a host edit, then a scene edit
- **GIVEN** the user moved a scene marker, then moved a Rhino object
- **WHEN** the user presses Undo twice
- **THEN** Rhino is asked to undo once, and then the scene undoes the marker's move

#### Scenario: Redo a host edit
- **GIVEN** the user undid a Rhino edit
- **WHEN** the user presses Redo
- **THEN** Rhino is asked to redo

### Requirement: A host that cannot edit says so
When the host that owns the objects cannot apply edits, the tool SHALL leave them as they are and say that the host does not take edits from HAI.

#### Scenario: A host without edits
- **GIVEN** a host whose hello says it cannot edit
- **WHEN** the user drags one of its objects with Move
- **THEN** nothing is sent and the notice says the host does not take edits from HAI
