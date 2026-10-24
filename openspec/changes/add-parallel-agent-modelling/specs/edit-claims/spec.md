# Spec Delta

## ADDED Requirements

### Requirement: A task can be given a scope
A task given to a specialist SHALL be able to carry a scope: any of a list of element ids, a part name, or a region (a box in millimetres). The scope is the part of the model that task may change. A task with no scope SHALL be treated as claiming the whole model, so it works as tasks do today. Mochi SHALL be able to hand out several tasks in one request, each with its own scope.

#### Scenario: Scoped hand-offs
- **WHEN** Mochi hands the task "dome" with the part `dome` to Architect and "hall" with a region to Product
- **THEN** both tasks are listed with their scopes

#### Scenario: No scope
- **WHEN** Mochi hands a task with no scope
- **THEN** the task is treated as claiming the whole model

### Requirement: Mochi gives parallel tasks a shared brief
When Mochi hands out tasks that may run together, it SHALL be able to set one short brief for them (for example the datum, grid, proportions and materials). Every specialist task in that request SHALL start with the brief, and any agent SHALL be able to read it while it works.

#### Scenario: Brief reaches every task
- **WHEN** Mochi hands three scoped tasks with the brief "grid 6 m, floor at 0, stone colour #d9c9a8"
- **THEN** each of the three agents is told that brief at the start of its task, and can read it again later

### Requirement: Writers with separate scopes work at the same time
While Parallel modelling is on, tasks that change the model SHALL run at the same time when their scopes do not overlap, up to the team's limit of tasks at once. A task whose scope overlaps a running task's scope, or which has no scope while any task runs, SHALL queue and start when the overlap ends. Agents that only read SHALL still work alongside. With Parallel modelling off, only one writer SHALL work at a time.

#### Scenario: Two disjoint writers
- **GIVEN** Architect works on part `dome` and Product is given part `hall`
- **WHEN** both tasks are handed out
- **THEN** both run at the same time

#### Scenario: Overlapping scopes queue
- **GIVEN** Architect works on the region around the north wall
- **WHEN** Product is given a task whose region includes that wall
- **THEN** Product's task shows as queued with the reason, and starts when Architect's task ends

#### Scenario: Switch off
- **GIVEN** Parallel modelling is off
- **WHEN** two writing tasks with disjoint scopes are handed out
- **THEN** the second queues until the first ends

### Requirement: A claim is checked wherever the model is changed
Every create, update, delete and tag change an agent makes SHALL be checked against that agent's current claim and against everyone else's claims. A change outside the agent's claim, or to an element another running task has claimed, SHALL be refused as a whole, with nothing changed, and the message SHALL say what is claimed by whom and what the agent can do (ask for more scope, or leave it). An element an agent creates inside its scope SHALL belong to its claim at once. The user SHALL be able to change anything; a user change to an element a running task has claimed SHALL be allowed and the owning agent SHALL be told at its next read.

#### Scenario: Touching another agent's wall
- **GIVEN** Architect's task claims the part `dome` and Product's claims `hall`, and `wall-h1` is in `hall`
- **WHEN** Architect tries to update `wall-h1`
- **THEN** the update is refused, the model is unchanged, and the message says `wall-h1` is claimed by Product's task "hall"

#### Scenario: Creating outside the scope
- **WHEN** Architect, whose claim is the region of the dome, creates a column outside it
- **THEN** the create is refused and the message names the region

#### Scenario: One bad element in a batch
- **WHEN** an agent submits three updates where one is outside its claim
- **THEN** none of the three is applied

#### Scenario: The user overrides
- **GIVEN** Product's task claims `hall`
- **WHEN** the user moves a column of `hall` by hand
- **THEN** the move is made, and Product's next read of that column says the user changed it

### Requirement: An agent can ask for more scope
An agent SHALL be able to read every running claim and to ask for more scope for its own task. The request SHALL be granted at once when nothing else claims it, and refused, naming the holder, otherwise. An agent SHALL be able to give part of its claim back.

#### Scenario: Extension granted
- **GIVEN** nothing claims element `col-9`
- **WHEN** Architect asks to add `col-9` to its claim
- **THEN** it is granted and Architect can change `col-9`

#### Scenario: Extension refused
- **GIVEN** Product's task claims `wall-h1`
- **WHEN** Architect asks to add `wall-h1`
- **THEN** it is refused and the message names Product's task

### Requirement: A claim ends with its task
A claim SHALL end when its task ends, whether it finished, failed, was stopped, was taken off the queue, or its agent crashed, and when the project is switched. A claimed scope SHALL NOT outlive its task. After a claim ends, a late call from that agent SHALL be refused.

#### Scenario: Stopped task frees its scope
- **GIVEN** Architect's task claims `dome` and a queued task of Product needs it
- **WHEN** the user stops Architect's task
- **THEN** the claim ends within 3 seconds and Product's task starts

#### Scenario: Late call after the task
- **GIVEN** Architect's task ended
- **WHEN** Architect's process calls update on an element it claimed
- **THEN** the call is refused

### Requirement: A claim check adds no noticeable delay
Checking a change against the claims SHALL add no more than 5 ms at the 90th percentile for a batch of 100 elements in a model of 5000 elements.

#### Scenario: Large batch
- **GIVEN** a model with 5000 elements and three running claims
- **WHEN** an agent updates 100 elements inside its claim
- **THEN** the claim check takes under 5 ms at the 90th percentile over 100 runs

### Requirement: Python files are reserved before the script runs
The tool that runs Python in the managed environment SHALL take the list of `.3dm` files the script will write. Those paths SHALL be reserved for the task, a run that names a path another running task has reserved SHALL be refused naming that task, and the written files offered to the user SHALL be those the run declared, attributed to it. A file the run wrote that it did not declare SHALL be reported to the agent and to the user as written outside its claim. Kept script names SHALL never collide between runs.

#### Scenario: Same file twice
- **GIVEN** Architect's run reserved `canopy.3dm`
- **WHEN** Product's run declares `canopy.3dm`
- **THEN** Product's run is refused and the message names Architect's task

#### Scenario: Undeclared write
- **WHEN** a run declared `hall.3dm` but also wrote `extra.3dm`
- **THEN** the agent's result and the user's file offer say `extra.3dm` was written outside the run's declared files

#### Scenario: Same title in the same second
- **WHEN** two runs with the same title start in the same second
- **THEN** each has its own kept script and neither overwrites the other

### Requirement: Rhino scripts are checked afterwards
A script run in Rhino SHALL carry the agent's name, the run's title and the task's claim. The objects it creates SHALL be stamped `hai.owner` and `hai.part` by the system without the script having to. After the run the system SHALL compare the document before and after, and report to the agent and the user every object the run added, changed or deleted outside its claim. The run SHALL remain one undo step in Rhino so the user can revert it, and Rhino SHALL run one script at a time whatever the number of agents. Because a script is not sandboxed, this check cannot prevent a change, and the report SHALL say so.

#### Scenario: Script stays in scope
- **GIVEN** Architect's claim is the part `dome`
- **WHEN** its script adds three surfaces and changes one `dome` object
- **THEN** the three surfaces carry `hai.owner` = `architect` and `hai.part` = `dome`, and the result reports no change outside the claim

#### Scenario: Script strays
- **WHEN** its script also moves an object claimed by Product
- **THEN** the result and the user's panel name that object, its claimant and what changed, with an offer to undo the run

#### Scenario: Scripts take turns
- **WHEN** two agents ask Rhino to run a script at the same moment
- **THEN** the scripts run one after the other, each as its own undo step
