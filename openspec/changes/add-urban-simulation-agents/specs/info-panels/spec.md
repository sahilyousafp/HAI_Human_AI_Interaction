# Spec Delta

## Purpose
Lets every agent, the lead and the readers included, show information in a panel, while keeping the rule that only agents that change the model can change it.

## ADDED Requirements

### Requirement: Every agent can offer a panel
The panel tools (offer, open, update, close) SHALL be offered to every agent on the team, Mochi included, while the Generated panels switch is on. This SHALL replace the earlier rule that only agents allowed to change the model can offer panels. The offer, the nod that opens it, the single open panel with a short queue of waiting offers, the agent's name on the panel and the offer card under the agent's hand-off chip SHALL work the same for every agent. The read-only helper subagents an agent starts SHALL NOT be offered panel tools.

#### Scenario: Mochi offers a panel
- **WHEN** Mochi lists its tools
- **THEN** the panel tools are among them, and Mochi can offer a panel with a purpose

#### Scenario: A reader offers a panel
- **WHEN** Climate lists its tools
- **THEN** the panel tools are among them

#### Scenario: Helpers have none
- **WHEN** a read-only helper started by an agent lists its tools
- **THEN** none of them is a panel tool

#### Scenario: Switch off
- **GIVEN** Generated panels is switched off
- **WHEN** any agent lists its tools
- **THEN** no panel tool is offered

### Requirement: A panel from an agent that does not change the model is information only
A panel opened by an agent that is not allowed to change the model SHALL be information only. It SHALL be able to read the scene and show what it likes within the panel's rules, but it SHALL NOT be able to preview or commit a change: the app SHALL refuse the operations such a panel sends, whatever the panel's code does (the panel can only speak through the page's one port, and the page does the refusing), and the panel's frame SHALL offer Close only, not Done. An information panel that tries to change the model SHALL leave the model unchanged and the agent SHALL be told it was refused.

#### Scenario: Information panel from Mochi
- **WHEN** Mochi opens a panel that lists the team's tasks
- **THEN** the panel shows the list, its frame offers Close only, and the model is unchanged when it closes

#### Scenario: A commit is refused
- **GIVEN** Climate's information panel runs code that tries to move a column
- **WHEN** the panel sends the change
- **THEN** it is refused, the column does not move, and Climate is told the panel is information only

#### Scenario: Writers keep their controls
- **WHEN** Architect opens a panel with a slider for a clearance
- **THEN** the slider previews the change live and Done keeps it as one undo step, as before

### Requirement: The agent says when a panel is for information
The tools' descriptions and the agents' instructions SHALL tell an agent that does not change the model that its panels are information only, and what a panel is good for (a table, a chart, a comparison, a summary the user can read at a glance), and SHALL tell a lead that a request for information to be shown MAY be answered by a panel it opens itself, or by a specialist's panel when the specialist has the knowledge. An old conversation started under the earlier instructions SHALL start fresh, as it does whenever the instructions change.

#### Scenario: Mochi answers with a panel
- **GIVEN** the user asks Mochi to show the status of the team on a panel
- **WHEN** Mochi answers
- **THEN** a panel with the status is offered by Mochi, and Mochi does not tell the user it has no panel tool

#### Scenario: Instructions changed
- **GIVEN** an agent conversation started before this change
- **WHEN** the agent is next used
- **THEN** it starts a new conversation under the current instructions

### Requirement: Information panels keep every panel rule
An information panel SHALL run in the same sandbox as any panel, with the same limits on size and message rate, SHALL NOT reach the network, and SHALL stay open when the turn that made it ends, until the user or the agent closes it. Closing it SHALL report to the agent that it was closed, not that a result was kept.

#### Scenario: Stop does not close it
- **GIVEN** an information panel is open and the agent is working
- **WHEN** the user stops the turn
- **THEN** the panel stays open until the user closes it

#### Scenario: No network
- **WHEN** an information panel's code tries to fetch a URL
- **THEN** the request is blocked by the panel's sandbox and the panel keeps working
