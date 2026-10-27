## MODIFIED Requirements

### Requirement: Tool activity is shown compactly
Each tool call SHALL appear in the turn as a compact chip with the tool name, its MCP server if any, and its outcome (running, needs approval, done, failed, denied). Expanding a chip SHALL show its input and its result or error. Two or more calls in a row SHALL be grouped into one steps line that names how many there are and the outcome that matters most: one waiting for approval first, then a failure or denial, then one still running, else done. While its turn runs the steps line SHALL say how many calls it has made so far. It SHALL be open while its turn runs or any of its calls waits or failed, and SHALL fold once the turn has ended with every call done, unless the user opened or folded it themselves; opening it SHALL show every chip. A call's approval card or panel offer SHALL follow its steps line.

#### Scenario: Failed tool call
- **WHEN** a scene tool call fails validation
- **THEN** its chip shows failed and expanding it shows the error message

#### Scenario: Several finished calls fold to one line
- **GIVEN** a turn made three tool calls and all are done
- **WHEN** the turn ends
- **THEN** the turn shows one folded line reading "3 steps, done", and opening it shows the three chips

#### Scenario: A waiting call keeps its line open
- **GIVEN** a turn has made two calls and the second needs approval
- **THEN** its steps line reads "Bash needs approval", is open, and the approval card follows it

### Requirement: The panel can be collapsed
The user SHALL be able to collapse the panel to a narrow strip and expand it again; the choice SHALL be remembered across reloads. The strip SHALL show the agent's status and name, how many approvals and panel offers are waiting, the microphone, and the way to expand it.

#### Scenario: Collapsed panel stays collapsed
- **GIVEN** the user collapsed the panel
- **WHEN** the page reloads
- **THEN** the panel shows only its strip

#### Scenario: Waiting approvals while collapsed
- **GIVEN** the panel is collapsed
- **WHEN** an approval card is waiting
- **THEN** the strip shows "1 to approve"

## ADDED Requirements

### Requirement: The chat is a docked rail beside the model
The agent panel SHALL be docked down the left of the workspace at full height, and the model view SHALL start at its edge, so the panel never covers the model. Below 860 px of window width the panel SHALL become a sheet over the bottom of the model, at most half its height. With the agent switched off there SHALL be no rail, and the model SHALL take the full width.

#### Scenario: Docked beside the model
- **GIVEN** a 1440 px wide window
- **WHEN** the app opens
- **THEN** the rail is 380 px wide and full height, and the model view starts at 380 px

#### Scenario: Narrow window
- **GIVEN** an 800 px wide window
- **THEN** the panel is a sheet across the bottom of the model, no taller than half of it

### Requirement: The rail's width can be changed by mouse, keys and hand
The rail's width SHALL be adjustable between 320 and 560 px, 380 by default. Dragging its edge SHALL set it, the arrow keys on the edge SHALL move it by 16 px, and a double-click SHALL restore the default. A hand press on the edge SHALL step through set widths, because a hand cannot drag it. The width SHALL be remembered across reloads.

#### Scenario: Resize by dragging
- **GIVEN** the rail is 380 px wide
- **WHEN** the user drags its edge 100 px to the right and reloads
- **THEN** the rail is 480 px wide and the model view starts at 480 px

#### Scenario: A hand press steps the width
- **GIVEN** the rail is 380 px wide
- **WHEN** the user presses its edge with a hand pointer
- **THEN** the rail becomes 460 px wide

### Requirement: Files and runs share one tray above the input
Files the agent's scripts wrote and reports of scripts that went outside their claim SHALL appear in one tray row above the input, labelled with their count, that the user can fold and unfold. The tray SHALL open when a new file or report arrives and SHALL not show when there are none.

#### Scenario: A written file opens the tray
- **WHEN** a Python run writes a `.3dm` file the user can import
- **THEN** the tray reads "Files and runs (1)", is open, and shows Import into viewer for the file
