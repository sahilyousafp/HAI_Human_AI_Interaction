# Spec Delta

## Purpose

HAI is where a person views and edits the work of host applications (Rhino, Blender, Revit) that an orchestrating agent directs. The hosts model with their own tools, and Speckle carries models between them.

## ADDED Requirements

### Requirement: Hosts model, HAI views
The system SHALL draw the model of every connected host in HAI's viewer as a live mirror. It SHALL NOT require the user to look at a host's window to follow, select or edit the work.

#### Scenario: A host models while minimised
- **GIVEN** a host is connected and its window is minimised
- **WHEN** an agent's approved run in that host adds an object
- **THEN** the object appears in HAI's viewer

### Requirement: Edits in HAI are applied by the owning host
A direct edit (move, rotate, delete or undo) that the user makes in HAI on a mirrored object SHALL be sent to the host that owns the object, and applied there as one undo record. The mirror SHALL then show the result.

#### Scenario: Move a host object by hand
- **GIVEN** a mirrored object from a connected host is selected in HAI
- **WHEN** the user moves it 2 m with the Move tool
- **THEN** the host moves the object 2 m in one undo record and HAI's mirror shows it at its new place

### Requirement: Agents model through code in a host
An agent SHALL change geometry only by running code in a connected host (or by writing a file with the Python workbench), each run after the user approves the script. Agents SHALL NOT have tools that create, change or delete geometry in HAI's own scene.

#### Scenario: No scene write tools
- **WHEN** the tools of any agent are listed
- **THEN** none of `create_elements`, `update_elements`, `transform_elements` or `delete_elements` is among them

### Requirement: One host contract
Every host connector SHALL implement the same contract: hello and state, mirror batches, selection both ways, run code with a result, undo, capture an image, place an image, apply an edit, and publish to or load from Speckle. The agent's tools SHALL take the host as an argument instead of being separate tools per host.

#### Scenario: A second host needs no new agent tools
- **GIVEN** Rhino and Blender are connected
- **WHEN** the tools of a modelling agent are listed
- **THEN** one `host_run` tool covers both, and its description names both hosts and what each does best

### Requirement: Speckle is the bus between hosts
A hand-off of a model from one host to another SHALL go through Speckle, published and loaded by HAI's own plugins without clicks in a Speckle connector. Speckle SHALL NOT be the source of HAI's live view.

#### Scenario: Rhino to Blender
- **GIVEN** the user is signed in to Speckle and Rhino and Blender are connected
- **WHEN** the orchestrator hands the massing from Rhino to Blender
- **THEN** Rhino's plugin publishes a version, Blender's plugin loads it, and the objects appear in HAI through Blender's mirror

### Requirement: HAI's scene is for sketches and references
HAI's own scene SHALL hold sketches, markers, named views and imported references. The tool rings SHALL offer no tool that creates building geometry in it.

#### Scenario: The rings offer no creation tools
- **WHEN** the default rings are shown
- **THEN** neither ring offers wall, slab, column, copy or massing

### Requirement: Other plugins and MCP servers add capabilities
The user SHALL be able to connect MCP servers and use the host's own plugins as extra capabilities. A connected server SHALL be offered to the agents working on the hosts it serves, behind the usual tool approval. A connected server SHALL NOT replace HAI's own connector for the mirror, edits and runs.

#### Scenario: A Grasshopper server for Rhino tasks
- **GIVEN** the user connected a server tagged for Rhino
- **WHEN** an agent starts a task on Rhino
- **THEN** that agent's tools include the server's tools, and the first call of one shows an approval card

#### Scenario: Installed host plugins are known
- **GIVEN** Rhino is connected with Ladybug installed
- **WHEN** a modelling agent reads its tools
- **THEN** the `host_run` description lists Ladybug among Rhino's installed plugins

### Requirement: Panels read the web through the bridge only
A generated panel SHALL reach web information only through the bridge, from the sites listed on its offer card. The panel's frame SHALL keep no network access of its own.

#### Scenario: An allowed site
- **GIVEN** the user accepted a panel offer listing one site
- **WHEN** the panel asks the bridge for a page on that site
- **THEN** the panel receives the content

#### Scenario: Any other site
- **WHEN** the same panel asks for a page on a site not on its card
- **THEN** the request is refused and the panel is told why

### Requirement: Panels show sourced images with their attribution
A panel or an agent SHALL be able to search openly licensed image sources and show the results with their licence, author and source. A chosen image SHALL be kept with its attribution and SHALL be placeable in a host.

#### Scenario: Pick a reference image
- **WHEN** a panel searches for "timber canopy" and the user picks a result
- **THEN** the image is saved with its licence and author, and the agent can place it in a connected host

### Requirement: Panels are worked by hand
Inside a generated panel, a hand pinch SHALL press, drag and scroll as a mouse would, and the pointer SHALL send hover. The panel's header SHALL move the panel when pinched and dragged.

#### Scenario: Drag inside a panel
- **GIVEN** a panel with a draggable map
- **WHEN** the user pinches on the map and moves the hand
- **THEN** the panel receives pointer down, moves and up at the pinch's places, and the map pans

#### Scenario: Move the panel
- **WHEN** the user pinches the panel's header and moves the hand
- **THEN** the panel follows the hand and stays inside the window
