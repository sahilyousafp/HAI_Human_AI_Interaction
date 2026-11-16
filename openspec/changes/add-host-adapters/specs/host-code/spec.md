# Spec Delta

## Purpose

Lets the agent work in a connected host by running code in the host's own language, under the user's approval. It also lets the agent look at the host's own viewport, put a reference picture into the host and look up the host's API. The same tools serve every host.

## ADDED Requirements

### Requirement: The agent can run code in a connected host
While a host is connected, switched on and able to run code, the agent SHALL have one tool, `host_run`, that runs a script in that host's language against its open document. In Rhino that is Python 3 with RhinoCommon, `rhinoscriptsyntax` and `scriptcontext`. A failure SHALL NOT stop the host or the connection.

#### Scenario: A script changes the document
- **GIVEN** Rhino is connected with Python ready and an empty document
- **WHEN** the agent runs a script in Rhino that adds a sphere with `rhinoscriptsyntax`
- **THEN** the document contains the sphere and the tool returns a successful result listing one added object

### Requirement: A run reports what it did
A run SHALL return everything the script printed (at most 20 000 characters), the value of a variable named `result` if the script set one, the duration, and what the run added, changed and deleted. A failed run SHALL return the error message and the end of the traceback.

#### Scenario: Output and result come back
- **WHEN** the agent runs a script that prints "hello" and sets `result = 42`
- **THEN** the tool's answer holds "hello" as the output and 42 as the result

#### Scenario: An error is returned, not thrown
- **WHEN** the agent runs a script that divides by zero
- **THEN** the tool answers with the error message and the line, the host keeps running, and the next run works

#### Scenario: Output is capped
- **WHEN** a script prints more than 20 000 characters
- **THEN** the answer holds the first 20 000 and says it was cut

#### Scenario: The host is named
- **WHEN** the agent calls `host_run` for a host that is not connected
- **THEN** the call is refused, naming the hosts that are connected

### Requirement: A run is one undo step in the host
Every run SHALL be one undo record in the host, labelled with the agent and the run's title, so one Undo in the host reverts everything the script changed.

#### Scenario: One undo reverts a run
- **WHEN** a script adds three objects in Rhino and the user then presses Undo once in Rhino
- **THEN** all three objects are gone

### Requirement: A run has a time limit and can be stopped
A run SHALL end at its time limit (60 seconds unless the request sets another, never more than 600) and SHALL end when the user stops the agent. A run that the host cannot interrupt SHALL have its result discarded at the limit, and the HUD SHALL say the host is still busy.

#### Scenario: Time limit
- **WHEN** a script runs longer than its limit
- **THEN** the tool answers that the run timed out, and the HUD does not claim the run finished

### Requirement: Running code in a host asks for approval
Running a script in a host SHALL ask the user before it runs, showing the whole script, the host and any packages it would install. In Rhino, packages are the script's `# r: package` lines. Always allow SHALL be kept per host and per project. It SHALL NOT cover a package the user has not approved before, and SHALL NOT cover another host.

#### Scenario: A run waits for the user
- **WHEN** the agent calls `host_run` for Rhino
- **THEN** an approval card naming Rhino with the full script appears, and nothing runs until the user allows it

#### Scenario: A package is listed for approval
- **WHEN** the agent proposes a Rhino script that starts with `# r: ladybug-core`
- **THEN** the approval card lists "ladybug-core" as a package it would install

#### Scenario: Always allow is per host
- **GIVEN** the user chose always allow for runs in Rhino
- **WHEN** the agent calls `host_run` for Blender
- **THEN** an approval card appears

#### Scenario: Old approvals carry over
- **GIVEN** a project that always allowed `rhino_run_python`
- **WHEN** the bridge starts and the agent calls `host_run` for Rhino with no new package
- **THEN** it runs without an approval card

### Requirement: The document can be read without running code
The agent SHALL have a read-only tool, `host_read`, that returns a host's units, its layers or collections (name, colour, visibility, object count), object counts by type, the selection and the active view, without asking for approval.

#### Scenario: Read the document
- **GIVEN** Rhino is connected with two layers and five objects
- **WHEN** the agent calls `host_read` for Rhino
- **THEN** it receives the units, both layers with their object counts, and the five objects counted by type, with no approval card

### Requirement: The agent can see the host's own viewport
The agent SHALL have a read-only tool, `host_capture`, that returns an image of the host's viewport: its active view, or one of HAI's named views, at most 1280 pixels on the long side. A capture SHALL answer within 1.5 seconds at 1280 by 720 on the reference laptop, or with the reason it failed.

#### Scenario: Capture Rhino's view
- **GIVEN** Rhino is connected with a model
- **WHEN** the agent calls `host_capture` for Rhino with the top view
- **THEN** it receives a PNG of Rhino's top view, and the tool chip shows how long it took

### Requirement: The agent can put an image into a host
An agent that changes the model SHALL have a tool, `host_place_image`, that places an image file from the project into a host on a given plane at a given width, embedded in the host's document, as one undo record. A path outside the project SHALL be refused.

#### Scenario: A site photo behind the model
- **GIVEN** the project holds `site.jpg`
- **WHEN** the agent places it in Rhino at the origin, facing north, 40 m wide
- **THEN** Rhino holds a picture frame with that image, one Undo removes it, and it is drawn in HAI's Rhino layer

#### Scenario: Outside the project
- **WHEN** the agent asks to place `C:/Windows/image.png`
- **THEN** the call is refused because the path is outside the project

### Requirement: The agent can look up the host's API
The agent SHALL have a read-only tool, `host_api`, that lists the types and members of the host's scripting API that match a query, with their signatures and summaries, at most 50, found inside the running host. It SHALL answer within 300 ms after the host's index is built.

#### Scenario: Look up a Rhino method
- **WHEN** the agent asks Rhino's API for "Brep.CreateFromLoft"
- **THEN** it receives that method's overloads with their parameters
