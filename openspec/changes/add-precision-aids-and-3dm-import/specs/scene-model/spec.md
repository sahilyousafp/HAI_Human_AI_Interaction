## ADDED Requirements

### Requirement: Scene holds imported reference geometry
The scene SHALL support an `imported` element: reference geometry read from another file, with an id, name, optional layer name, optional display colour, a reference to a binary asset in the project folder, a bounding box in millimetres, and a translation in millimetres (what moving it changes). Its shape SHALL NOT be an element field; the asset holds it. It SHALL take part in selection, bounds, undo, redo and the shared scene like any other element, and a scene with a reference to a missing asset SHALL open with that element drawn as its bounding box and an error noted, not fail to open.

#### Scenario: Valid imported element
- **WHEN** a scene contains an imported element with an asset, a bounding box and a translation
- **THEN** it validates and shows in the scene read by clients

#### Scenario: Missing asset
- **GIVEN** the asset file was deleted from the project folder
- **WHEN** the project opens
- **THEN** the project opens, the element is drawn as its bounding box, and the status names the missing asset

#### Scenario: Moving updates the translation
- **WHEN** an imported element is moved by (1000, 0) mm
- **THEN** its translation changes by (1000, 0) and its asset is untouched

#### Scenario: Invalid fields are named
- **GIVEN** a scene file with an imported element whose bounding box is missing
- **WHEN** the scene is read with validation
- **THEN** the error names the element id and the field
