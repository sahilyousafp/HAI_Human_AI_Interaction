# Spec Delta

## Purpose

Lets the agent model and draft in the user's open Rhino document by running Python in Rhino 8, with all of RhinoCommon and `rhinoscriptsyntax` and any library Rhino can install, under the user's approval.

## ADDED Requirements

### Requirement: The agent can run Python in the open Rhino document
While Rhino is connected and its Python is ready, the agent SHALL have a tool that runs a Python 3 script inside Rhino against the open document, with RhinoCommon, `rhinoscriptsyntax` and `scriptcontext` available. The tool SHALL return everything the script printed, the value of a variable named `result` if the script set one, the duration, and, if the script failed, the error message and the end of the traceback. Output SHALL be limited to 20 000 characters, and a failure SHALL NOT stop Rhino or the connection.

#### Scenario: A script changes the document
- **GIVEN** Rhino is connected with Python ready and an empty document
- **WHEN** the agent runs a script that adds a sphere with `rhinoscriptsyntax`
- **THEN** the document contains the sphere and the tool returns a successful result

#### Scenario: Output and result come back
- **WHEN** the agent runs a script that prints "hello" and sets `result = 42`
- **THEN** the tool's answer holds "hello" as the output and 42 as the result

#### Scenario: A Python error is returned, not thrown
- **WHEN** the agent runs a script that divides by zero
- **THEN** the tool answers with the error message and the line, Rhino keeps running, and the next run works

#### Scenario: Output is capped
- **WHEN** a script prints more than 20 000 characters
- **THEN** the answer holds the first 20 000 and says it was cut

### Requirement: A run is one undo step
Every run SHALL be one Rhino undo record, labelled with the agent and the run's title, so one Undo in Rhino reverts everything the script changed.

#### Scenario: One undo reverts a run
- **WHEN** a script adds three objects and the user then presses Undo once in Rhino
- **THEN** all three objects are gone

### Requirement: A run has a time limit and can be stopped
A run SHALL end at its time limit (60 seconds unless the request sets another, never more than 600) and SHALL end when the user stops the agent. A run that Rhino cannot interrupt SHALL have its result discarded at the limit and the HUD SHALL say that Rhino is still busy.

#### Scenario: Time limit
- **WHEN** a script runs longer than its limit
- **THEN** the tool answers that the run timed out, and the HUD does not claim the run finished

### Requirement: Packages come through Rhino's own requirement lines
A script MAY name third-party packages in `# r: package` comment lines at its top. The bridge SHALL read those lines before the run and show every package on the approval card, and the script SHALL NOT run until the user has approved them.

#### Scenario: A package is listed for approval
- **WHEN** the agent proposes a script that starts with `# r: ladybug-core`
- **THEN** the approval card shows the script and lists "ladybug-core" as a package it would install

### Requirement: The document can be read without running code
The agent SHALL have a read-only tool that returns the open document's units, layers (name, colour, visibility, object count), object counts by type, the selection and the active view, without asking for approval.

#### Scenario: Read the document
- **GIVEN** Rhino is connected with two layers and five objects
- **WHEN** the agent calls the read tool
- **THEN** it receives the units, both layers with their object counts, and the five objects counted by type, with no approval card

### Requirement: Running Python in Rhino asks for approval
Running a script in Rhino SHALL ask the user before it runs, like any tool that is not pre-approved, and SHALL show the whole script.

#### Scenario: A run waits for the user
- **WHEN** the agent calls the run tool
- **THEN** an approval card with the full script appears and nothing runs until the user allows it
