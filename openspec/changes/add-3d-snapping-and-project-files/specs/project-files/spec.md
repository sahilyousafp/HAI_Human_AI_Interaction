## ADDED Requirements

### Requirement: A new project starts with a clean space
The project bar SHALL have a New project button that asks for a project folder and creates a project there with an empty scene: one ground level at 0 mm and no elements, not the sample building. The new project SHALL open at once for every client, the selection and undo history SHALL be empty, and the view SHALL frame the empty ground. A folder that already holds a project SHALL NOT be touched: the user is told, and nothing changes.

#### Scenario: Start empty
- **WHEN** the user presses New project and enters a folder that has no project
- **THEN** the folder gets a scene file with one ground level and no elements, it opens, and the project bar shows its name

#### Scenario: Import into it
- **GIVEN** a new project
- **WHEN** the user imports a `.3dm` file
- **THEN** only the imported model is in the scene

#### Scenario: Draw in it
- **GIVEN** a new project and the Wall tool
- **WHEN** the user draws a wall
- **THEN** the wall is on the ground level and is the only element

#### Scenario: An existing project is not overwritten
- **GIVEN** a folder that holds a project
- **WHEN** the user enters it as a new project
- **THEN** the project is not changed, and the message says the folder already holds a project

### Requirement: A project can be saved as a Rhino file
The project bar SHALL have a Save as 3dm button that builds a `.3dm` file from the open scene in the browser and offers it as a download named after the project. The file SHALL be in millimetres, Z up, and SHALL contain: each wall, slab, column and massing as a native Rhino extrusion of its footprint at its real base height; each imported element as a mesh moved by its translation; each element on a layer named after its type ("Walls", "Slabs", "Columns", "Massings") or, for imported ones, after its source layer (else "Imported"); the element's name as the object name; and its properties and id as user strings. Imported elements' display colours SHALL be kept. Nothing leaves the machine, and saving SHALL NOT change the scene.

#### Scenario: Save a drawn project
- **GIVEN** a project with a wall, a slab and a column
- **WHEN** the user presses Save as 3dm and the file is read back
- **THEN** it has 3 extrusions on the layers Walls, Slabs and Columns, named like the elements, in millimetres

#### Scenario: Heights and sizes are exact
- **GIVEN** a wall 6000 mm long, 200 mm thick and 3000 mm high on a level at 4500 mm
- **WHEN** it is saved and read back
- **THEN** its extrusion is 6000 by 200 mm in plan, 3000 mm tall, with its base at 4500 mm

#### Scenario: Imported models come back as meshes
- **GIVEN** an imported model moved 1000 mm along X
- **WHEN** it is saved and read back
- **THEN** its mesh is 1000 mm further along X than the original, on its source layer, in its colour

#### Scenario: The file opens in the same reader
- **WHEN** a saved file is imported again
- **THEN** it imports without errors, and the report counts every saved object

#### Scenario: An empty project
- **WHEN** the user saves a project with no elements
- **THEN** the message says there is nothing to save, and no file is offered
