# Spec Delta

## Purpose

Lets the agent offer, and the user accept, a small interface written for the task at hand (for example a tolerance panel) that floats over the model, changes it live and is closed by the user when done, without ever being able to reach anything beyond the scene.

## ADDED Requirements

### Requirement: The agent offers a panel and the user decides
The agent SHALL be able to offer a panel by stating its purpose, and the system SHALL show the offer to the user as a card with Open and Skip actions. A panel SHALL NOT open unless the user accepts an offer, and one accepted offer SHALL allow exactly one panel. An offer made while a panel is open, or while another offer is waiting, SHALL be refused with an error that says so.

#### Scenario: Offer is shown
- **WHEN** the agent offers a panel with the purpose "Set the wall to column clearance"
- **THEN** a card shows that purpose with Open and Skip, and no panel is open

#### Scenario: Panel without an accepted offer is refused
- **GIVEN** no offer has been accepted
- **WHEN** the agent tries to open a panel
- **THEN** no panel opens and the agent receives an error saying that the user has not accepted a panel

#### Scenario: One offer, one panel
- **GIVEN** the user accepted an offer and the agent opened a panel
- **WHEN** the agent tries to open a second panel without a new offer
- **THEN** the second panel is refused

#### Scenario: Offer while a panel is open
- **GIVEN** a panel is open
- **WHEN** the agent offers another panel
- **THEN** the offer is refused with an error that a panel is already open

### Requirement: Accepting or declining is answered at once
Accepting an offer SHALL show the panel frame within 150 ms, with a loading state until the agent supplies the panel. Declining SHALL tell the agent that the user skipped, and the agent SHALL carry on in chat. An offer left unanswered for 60 seconds SHALL expire and tell the agent so.

#### Scenario: Frame appears before the content
- **GIVEN** an offer is waiting and the agent has not yet written the panel
- **WHEN** the user accepts it
- **THEN** a panel frame with a loading state is visible within 150 ms

#### Scenario: Skip
- **GIVEN** an offer is waiting
- **WHEN** the user presses Skip
- **THEN** the offer card shows "Skipped", no panel opens, and the agent is told the user skipped

#### Scenario: Offer expires
- **WHEN** an offer is left unanswered for 60 seconds
- **THEN** the card shows "Expired" and the agent is told

#### Scenario: Declined panel frame is removed
- **GIVEN** the user accepted an offer and the loading frame is visible
- **WHEN** the turn ends without the agent supplying a panel
- **THEN** the frame closes and the offer shows "No panel was made"

### Requirement: The agent supplies and updates the panel as one HTML document
After an offer is accepted the agent SHALL be able to supply the panel as one self-contained HTML document with a title and a size, and later replace it with another. A document larger than 256 KB SHALL be refused with an error that gives the limit. Replacing a panel SHALL discard any uncommitted preview from the previous document.

#### Scenario: Panel appears
- **GIVEN** the user accepted an offer
- **WHEN** the agent supplies a valid document titled "Clearance"
- **THEN** the loading state is replaced by the document and the title shows in the panel header

#### Scenario: Oversized document
- **WHEN** the agent supplies a document of 300 KB
- **THEN** it is refused, the error names the 256 KB limit, and the offer stays accepted so the agent can try again

#### Scenario: Replace discards preview
- **GIVEN** a panel is open and its control has previewed a column move that is not committed
- **WHEN** the agent replaces the panel
- **THEN** the column is back where it was and the new document is shown

### Requirement: The panel floats over the viewport without blocking the model
The panel SHALL float over the viewport, SHALL be movable by dragging its header, and SHALL stay inside the window. It SHALL NOT stop orbiting, panning, zooming or selecting outside its own area, and the model beneath it SHALL NOT be picked through it. Only one panel SHALL be open at a time.

#### Scenario: Move the panel
- **GIVEN** a panel is open
- **WHEN** the user drags its header 200 pixels left
- **THEN** the panel moves 200 pixels left and stays fully inside the window

#### Scenario: Navigation continues
- **GIVEN** a panel is open
- **WHEN** the user orbits the view with the mouse outside the panel
- **THEN** the view orbits

#### Scenario: Nothing picked through the panel
- **GIVEN** a column lies directly beneath the panel
- **WHEN** the user presses on the panel over that column
- **THEN** the column is not selected

### Requirement: The panel looks like part of the app
The panel SHALL receive the app's current theme (light or dark), colours, type and control styles, so a panel written without any styling is legible and consistent with the HUD, and SHALL follow a theme change while it is open.

#### Scenario: Theme follows the app
- **GIVEN** a panel is open in the light theme
- **WHEN** the user switches the app to the dark theme
- **THEN** the panel's background and text colours change to the dark theme without reloading its content

### Requirement: The panel runs in a sandbox
The panel's code SHALL run isolated from the app. It SHALL NOT be able to read the session token or any other data of the app's page, call the bridge, make any network request, load resources from outside itself, open windows, navigate the app, or call the agent's tools. A panel that tries any of these SHALL fail only that attempt and SHALL NOT affect the app.

#### Scenario: Token unreachable
- **GIVEN** a panel whose script tries to read the session token from its parent page
- **WHEN** the panel loads
- **THEN** the read fails and the token is not exposed to the panel

#### Scenario: No network
- **GIVEN** a panel whose script calls fetch on an outside address and on the bridge's address
- **WHEN** the panel loads
- **THEN** neither request is sent

#### Scenario: Cannot navigate the app
- **GIVEN** a panel whose script tries to navigate the top window or open a new window
- **WHEN** the panel loads
- **THEN** the app stays where it is and no window opens

#### Scenario: A broken panel does not break the app
- **GIVEN** a panel whose script throws an error on load
- **WHEN** the panel loads
- **THEN** the panel header shows that the panel failed, the agent is told, and the viewer and agent panel keep working

### Requirement: The panel can only read the scene and send scene operations
A panel SHALL be able to read the current scene and selection, to be told when they change, and to send scene operations. Every operation SHALL be checked against the same scene schema as every other edit before it is shown or kept. An invalid operation SHALL change nothing and the panel SHALL be told which element and field were invalid. Operations SHALL be limited to 60 messages per second per panel; excess messages SHALL be dropped and the panel told.

#### Scenario: Panel reads the scene
- **GIVEN** a panel is open on the sample scene
- **WHEN** the panel asks for the elements of type column
- **THEN** it receives those columns with their ids and properties

#### Scenario: Invalid operation
- **WHEN** the panel sends an update that sets a wall's height to zero
- **THEN** the wall is unchanged and the panel is told that the height of that wall is invalid

#### Scenario: Flooding is limited
- **WHEN** the panel sends 200 operations in one second
- **THEN** no more than 60 are accepted and the panel is told that the rest were dropped

### Requirement: Controls change the model live without saving it
While the panel sends preview operations, the viewer SHALL show the model as if they were applied, as each animation frame is drawn. A preview SHALL NOT create an undo step, be written to the project, be seen by the agent or other clients, or change the scene on the bridge. A later preview SHALL replace the earlier one.

#### Scenario: Slider moves the column live
- **GIVEN** a panel with a clearance slider that moves a column
- **WHEN** the slider is dragged from 150 mm to 200 mm
- **THEN** the viewer shows the column 50 mm further away while the bridge's scene still holds the original position

#### Scenario: Preview leaves no history
- **GIVEN** a panel has previewed three different positions
- **WHEN** the user presses undo
- **THEN** the undo applies to the last committed change, not to a preview

#### Scenario: Agent does not see previews
- **GIVEN** a panel is previewing a moved column
- **WHEN** the agent reads the element
- **THEN** it receives the committed position

### Requirement: The frame carries Done and Close
The panel's frame SHALL carry Done and Close controls that the panel's own content cannot hide, move or imitate.

#### Scenario: Panel cannot hide the frame controls
- **GIVEN** a panel whose styles try to cover the whole window and hide the header
- **WHEN** it is shown
- **THEN** Done and Close are still visible and pressable and the panel stays within its frame

### Requirement: Done keeps the result as one undo step and Close restores the model
Done SHALL commit the panel's current preview as one transaction labelled with the panel's title and close the panel, so one undo reverts it. Close SHALL discard the preview and leave the model as it was at the panel's last commit. A panel SHALL also be able to commit its current preview from its own controls and stay open, each commit being one undo step.

#### Scenario: Done commits once
- **GIVEN** a panel previewed moving a column and resizing a slab
- **WHEN** the user presses Done
- **THEN** both changes are in the scene as one transaction labelled with the panel's title, the panel closes, and one undo reverts both

#### Scenario: Close discards
- **GIVEN** a panel is previewing a moved column
- **WHEN** the user presses Close
- **THEN** the column is back at its committed position and no undo step was added

#### Scenario: Commit from the panel twice
- **GIVEN** a panel with its own Apply control
- **WHEN** the user changes a control and presses Apply, then changes it again and presses Apply
- **THEN** the panel is still open and two undo steps exist, one per commit
### Requirement: Hand presses reach the panel's controls
While engaged, a hand pointer press over the panel SHALL act on the control beneath it, and a hand-dragged slider SHALL move as a mouse-dragged one does. The system's own panel controls (header, Done, Close) SHALL be pressable by hand.

#### Scenario: Press a button inside the panel
- **GIVEN** a panel with a button that sets the clearance to 150 mm
- **WHEN** a hand pointer presses at the button's position
- **THEN** the button's action runs

#### Scenario: Press Close by hand
- **GIVEN** a panel is open
- **WHEN** a hand pointer presses Close
- **THEN** the panel closes

### Requirement: The user closes the panel and the agent is told
The user SHALL be able to close the panel with Close, with Escape while the panel has focus, or with Done. The agent SHALL be told that the panel closed and whether the result was kept (Done) or discarded, and SHALL be able to answer in chat. The agent SHALL also be able to close the panel itself. If the connection to the bridge is lost, the panel SHALL close and discard its preview.

#### Scenario: Close with Escape
- **GIVEN** a panel is open and has focus
- **WHEN** the user presses Escape
- **THEN** the panel closes and its preview is discarded

#### Scenario: Agent learns the outcome
- **GIVEN** a panel is open and the user presses Done
- **WHEN** the panel closes
- **THEN** the agent is told the panel closed with the result kept

#### Scenario: Agent closes the panel
- **GIVEN** a panel is open
- **WHEN** the agent closes it
- **THEN** the panel closes and any uncommitted preview is discarded

#### Scenario: Connection lost
- **GIVEN** a panel is previewing a moved column
- **WHEN** the connection to the bridge is lost
- **THEN** the panel closes and the column shows its committed position

### Requirement: Only agents that change the model can offer panels
Panel tools SHALL be offered only to agents allowed to change the model, because a panel changes it. A panel offered by a specialist SHALL show its offer card under that agent's hand-off chip in Mochi's chat as well as in the agent's own conversation.

#### Scenario: Reviewer cannot offer
- **WHEN** the Reviewer agent lists its tools
- **THEN** none of them is a panel tool

#### Scenario: Specialist offer is findable
- **GIVEN** Architect offers a panel during a delegated task
- **WHEN** the offer card is shown
- **THEN** it appears under Architect's hand-off chip in Mochi's chat

### Requirement: The panel outlives the agent's turn
A panel SHALL stay open and usable when the turn that made it ends or is stopped, until the user or the agent closes it.

#### Scenario: Stop does not close the panel
- **GIVEN** a panel is open and the agent is working
- **WHEN** the user stops the turn
- **THEN** the panel stays open and Done still commits its preview

### Requirement: Generated panels can be switched off
The settings SHALL have a Generated panels feature switch, on by default. While it is off, the agent SHALL NOT be offered the panel tools, and an open panel SHALL close and discard its preview when the switch is turned off.

#### Scenario: Switched off
- **GIVEN** the Generated panels switch is off
- **WHEN** the agent lists its tools
- **THEN** none of them is a panel tool

#### Scenario: Switched off while open
- **GIVEN** a panel is previewing a moved column
- **WHEN** the user turns the Generated panels switch off
- **THEN** the panel closes and the column shows its committed position

### Requirement: Navigation never waits on a panel
Opening, loading, updating or failing to load a panel SHALL NOT delay orbiting, panning, zooming, selecting or drawing.

#### Scenario: Orbit while the panel loads
- **GIVEN** the user accepted an offer and the agent has not yet supplied the panel
- **WHEN** the user orbits the view
- **THEN** the view orbits without waiting for the panel
