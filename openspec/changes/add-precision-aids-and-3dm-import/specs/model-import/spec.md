## ADDED Requirements

### Requirement: A .3dm file can be imported
The project bar SHALL have an Import button that opens a file picker for `.3dm` files, and dropping a `.3dm` file on the viewer SHALL import it too. The file SHALL be read in the browser (in a Web Worker); it SHALL NOT be uploaded anywhere but to the local bridge, and only the converted geometry SHALL be. Meshes, Breps (using their render meshes) and extrusions SHALL become imported elements: one per object, named after the object (or its layer when it has no name), carrying the layer name and the object's display colour. A file with more than 1000 such objects SHALL instead become one element per layer and display colour, so the scene stays small and quick to draw. Coordinates SHALL be scaled from the file's unit system to millimetres and kept Z-up. The import SHALL be one undo step, and the model SHALL frame itself in the view when it arrives.

#### Scenario: Import by file picker
- **GIVEN** a project is open
- **WHEN** the user chooses a `.3dm` file with 3 meshes and 2 Breps in the Import picker
- **THEN** 5 imported elements appear in the viewer, the view frames them, and a report says 5 objects were imported

#### Scenario: Drop on the viewer
- **WHEN** the user drops a `.3dm` file on the viewer
- **THEN** it is imported as by the picker, and the drop zone message shows while the file is over the viewer

#### Scenario: A big model is grouped by layer
- **GIVEN** a file with 1200 meshes on 3 layers
- **WHEN** it is imported
- **THEN** 3 imported elements appear, one per layer and colour, each named after its layer and the number of objects it holds, and the report says 1200 objects were imported as 3 elements

#### Scenario: Units are scaled
- **GIVEN** a file saved in metres with a 2 m wide box
- **WHEN** it is imported
- **THEN** the element is 2000 mm wide

#### Scenario: Layers and colours kept
- **GIVEN** an object on the layer "Facade" displayed in red
- **WHEN** it is imported
- **THEN** its element has the layer "Facade" and is drawn red

#### Scenario: One undo
- **GIVEN** a file was imported
- **WHEN** the user undoes
- **THEN** every imported element is gone, and redo brings them back

### Requirement: The import says what it did not bring in
After every import a report SHALL list how many objects were imported and how many were skipped, by reason (curves, points, annotations, blocks that could not be expanded, objects with no mesh, unsupported). A file that yields nothing, is not a valid 3dm, was written by a newer Rhino than the reader supports, or is over the size limit SHALL change nothing in the scene and SHALL say why in plain words.

#### Scenario: Skipped objects counted
- **GIVEN** a file with 2 meshes, 4 curves and 1 text note
- **WHEN** it is imported
- **THEN** the report says 2 imported and 5 skipped (4 curves, 1 annotation)

#### Scenario: Not a 3dm file
- **WHEN** the user chooses a file named model.3dm whose contents are text
- **THEN** the scene is unchanged and the report says the file could not be read as a Rhino file

#### Scenario: Wrong file type
- **WHEN** the user drops a `.png` on the viewer
- **THEN** nothing is imported and the message says only .3dm files can be imported

#### Scenario: Too large
- **GIVEN** a file whose geometry would exceed 500 MB or 5 million triangles
- **WHEN** it is imported
- **THEN** the scene is unchanged and the report names the limit

### Requirement: Imported geometry is stored beside the scene
The converted geometry SHALL be saved as one binary asset in the project folder and referenced by the scene file, so the scene file stays small and saves quickly. The asset SHALL be read and written only through the bridge, with the session token, and never by path from the browser. Reopening the project SHALL show the imported geometry without the original file. An asset that no element refers to any more SHALL be removed when the project is next opened.

#### Scenario: Survives a restart
- **GIVEN** a file was imported and the project saved
- **WHEN** the bridge restarts and the project reopens
- **THEN** the imported elements appear as before and the original `.3dm` is not needed

#### Scenario: The scene file stays small
- **GIVEN** a file with 200 000 triangles was imported
- **WHEN** the project is saved
- **THEN** `scene.hai.json` is under 100 KB larger than before and the geometry is in the asset file

#### Scenario: Token required
- **WHEN** a request for an asset has no session token
- **THEN** it is refused

#### Scenario: Unused assets are cleaned up
- **GIVEN** an asset no element refers to
- **WHEN** the project is opened
- **THEN** the asset file is removed

### Requirement: Imported geometry works with the tools and the agent
Imported elements SHALL be selectable and SHALL be measured, sectioned, moved, copied and deleted like other elements. They SHALL be reference geometry: no tool edits their shape. The agent SHALL see each as an element with its id, name, layer, colour and bounding box, SHALL be able to move, copy and delete it, and SHALL NOT be sent the triangles.

#### Scenario: Move an imported object
- **GIVEN** an imported element
- **WHEN** the user moves it 1000 mm along X with the Move tool
- **THEN** it is 1000 mm further along X, as one undo step

#### Scenario: The agent sees bounds, not triangles
- **WHEN** the agent reads the scene
- **THEN** each imported element has its layer and bounding box and no vertex data

#### Scenario: Section cuts it
- **GIVEN** a section at 1500 mm
- **WHEN** the model contains an imported element 3000 mm tall
- **THEN** only the part below 1500 mm is drawn
