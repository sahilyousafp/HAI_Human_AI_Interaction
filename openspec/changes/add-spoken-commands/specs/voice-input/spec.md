## ADDED Requirements

### Requirement: A spoken command runs without the agent
A transcript that the command grammar understands completely SHALL be run at once on what "this" is (the elements pointed at while speaking, else the selection), without the agent and without a send countdown, and the voice bar SHALL say what was done and that nothing was sent. The grammar SHALL cover move (a distance and a direction, in mm, cm or m), copy (once, at a distance, or a number of times each one step further along), rotate, scale, mirror, select (all, a type, a level or none), delete, hide, isolate and show all. Steps SHALL chain with "and", "then" or a comma, each acting on what the one before left, and a chain that changes the model SHALL be one undo step named after what was said. With nothing to act on, the command SHALL say "Select something first." and change nothing.

#### Scenario: A chain of two steps
- **GIVEN** a massing is selected
- **WHEN** the user says "copy and rotate 90"
- **THEN** one copy of it is created and turned 90 degrees about itself, the original is unchanged, the copy is selected, and one Undo removes the copy

#### Scenario: A line of copies
- **GIVEN** a massing is selected
- **WHEN** the user says "copy 4 times 6 m along y"
- **THEN** four copies are created, each 6 m further along y than the one before, in one undo step

### Requirement: A command is understood completely or not at all
A transcript SHALL be a command only when every word of it is understood. One word the grammar does not know SHALL make the whole transcript a request for the agent, unchanged. A whole type of element SHALL be deleted, hidden or isolated only when the transcript says "all" ("remove the wall" is not "remove every wall"), and a tool's own spoken name SHALL still pick that tool.

#### Scenario: A part the grammar does not know
- **WHEN** the user says "rotate 90 and make it taller"
- **THEN** nothing is run and the transcript goes to the agent as a request

### Requirement: Delete is confirmed, hide is not a change
A spoken delete SHALL ask first, as the Delete tool does, and delete only on a nod or Enter. Hide and isolate SHALL change only what is drawn, picked and snapped to in the viewer: nothing is saved, undone or sent to the bridge, and "show all" SHALL bring everything back.

#### Scenario: Delete asks
- **GIVEN** a wall is selected
- **WHEN** the user says "delete this"
- **THEN** the wall is still there and a question waits; Enter deletes it and Escape keeps it

### Requirement: With Claude chat off only commands run
With the Claude chat feature off, a transcript that is not a command SHALL show "Not a command: " and the transcript, and SHALL NOT be sent to any agent. Listening for names SHALL be off. A microphone button and the voice bar SHALL stay available over the model, since the chat panel that holds them is absent.

#### Scenario: Not a command
- **GIVEN** Claude chat is off
- **WHEN** the user says "make the building taller"
- **THEN** the bar says "Not a command: make the building taller" and nothing is sent
