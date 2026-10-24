# Spec Delta

## ADDED Requirements

### Requirement: A specialist can start workers for parts of its task
An agent that changes the model SHALL be able to start a worker for a part of its own task, giving the worker a title, an instruction and a scope. A worker SHALL run as its own agent session, started from its parent's definition, with its own identity, so that the system can tell its changes from its parent's and from every other worker's. Mochi and workers SHALL NOT be able to start workers, and a worker SHALL NOT be able to hand tasks to other agents.

#### Scenario: Architect starts two workers
- **WHEN** Architect starts a worker for the dome and one for the minarets
- **THEN** two worker sessions run, each named after Architect with a number, and each is told its own title and instruction

#### Scenario: Workers cannot start workers
- **WHEN** a worker tries to start a worker
- **THEN** the request is refused and says that workers cannot start workers

### Requirement: A worker's scope is cut from its parent's claim
A worker's scope SHALL lie inside its parent's claim, and SHALL NOT overlap another worker's scope. A request whose scope is outside the parent's claim, or overlaps a running worker's, SHALL be refused naming the reason and the holder. The parent SHALL keep the rest of its claim. While a worker runs, the parent SHALL NOT change the part the worker holds.

#### Scenario: Scope outside the parent's claim
- **GIVEN** Architect's claim is the part `pavilion`
- **WHEN** it starts a worker for the part `harbour`
- **THEN** the request is refused because `harbour` is outside its claim

#### Scenario: Overlapping workers
- **GIVEN** a worker holds the part `dome`
- **WHEN** Architect starts a second worker with a scope that includes elements of `dome`
- **THEN** the request is refused and names the first worker

#### Scenario: The parent leaves the worker's part alone
- **GIVEN** a worker holds `dome`
- **WHEN** Architect tries to update an element of `dome`
- **THEN** the update is refused and names the worker

### Requirement: Each worker's changes are its own undo step
A worker's changes SHALL be recorded as their own undo step, labelled with the worker's name and title, and the parent's changes as its own. Every change SHALL say which worker made it, and elements a worker creates SHALL carry it as their owner.

#### Scenario: Undo one worker
- **GIVEN** Architect's workers for the dome and the minarets have both finished
- **WHEN** the user presses undo once
- **THEN** the step that ended last is reverted and the other worker's elements remain

### Requirement: A task ends after its workers
A task SHALL NOT finish while any of its workers is running. The parent SHALL receive each worker's outcome and summary when it ends. When the parent's task is stopped, fails or its agent crashes, its workers SHALL be stopped too, and their claims released within 3 seconds.

#### Scenario: Parent waits
- **GIVEN** Architect's own work is done but a worker is still running
- **WHEN** the board is shown
- **THEN** Architect's task is still running and shows the worker it waits for

#### Scenario: Stop the parent
- **GIVEN** Architect and two workers are working
- **WHEN** the user stops Architect's task
- **THEN** within 3 seconds all three are stopped and their claims are released

### Requirement: Sessions are limited
The number of agent sessions running at once, workers included, SHALL be limited to a number set in Settings (6 by default). A request to start a worker beyond the limit SHALL wait in a queue and start when a session ends, and the specialist SHALL be told it is queued. The settings SHALL say that each worker is a model session with its own cost.

#### Scenario: Over the limit
- **GIVEN** the limit is 4 and four sessions run
- **WHEN** a specialist starts another worker
- **THEN** the worker shows as queued and starts when a session ends

### Requirement: Workers are shown under their parent
The agent panel SHALL show a worker nested under its parent, in the parent's colour, with its title, state and scope, and the Parts list and the model's owner display SHALL show its part. An approval card from a worker SHALL name the worker and appear under its parent's chip. The model's owner display SHALL show workers in the parent's colour.

#### Scenario: Nested display
- **WHEN** Architect has two workers
- **THEN** the team strip shows both under Architect, each with its title and state

#### Scenario: Worker approval
- **WHEN** a worker needs the user to allow a script
- **THEN** the card names the worker and waits under Architect's chip

### Requirement: Native subagents only look
Every agent SHALL be able to use Claude Code's own subagents for reading, researching and reviewing, and every subagent the system makes available SHALL have only the tools that read the model and the view, never one that changes it or runs a script. Such a subagent acts as its parent, so changing the model with help SHALL go through a worker instead. A project agent of the same name as a teammate SHALL NOT be usable as a subagent with that teammate's modelling tools.

#### Scenario: Subagent has no modelling tools
- **WHEN** Architect starts a Claude Code subagent named after another teammate
- **THEN** that subagent's tools are only those that read the model and the view

#### Scenario: Helping with research
- **WHEN** Architect asks a subagent to look up the layout of a historic garden
- **THEN** the subagent can read the model and search, and returns what it found to Architect

### Requirement: Panels work with several agents
While a panel is open, another agent's offer of a panel SHALL wait in a queue of at most two, instead of being refused, and the offering agent SHALL be told it is waiting; an offer that waits more than a minute SHALL expire. A panel SHALL show the name of the agent that opened it. Mochi SHALL be able to offer a plan panel that shows how a request is split into parts, with each part's agent and scope, and lets the user remove a part or confirm, before any worker starts.

#### Scenario: Second offer waits
- **GIVEN** a panel from Architect is open
- **WHEN** Product offers a panel
- **THEN** Product's offer waits, and shows when the first panel closes

#### Scenario: Plan panel
- **WHEN** Mochi offers a plan panel for a pavilion split into dome, minarets and garden
- **THEN** the panel lists the three parts with their agents, the user removes "garden" and confirms, and only two workers start
