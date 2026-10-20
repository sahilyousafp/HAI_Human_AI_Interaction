# Spec Delta

## Purpose

Lets one lead agent, Mochi, turn the user's requests into work for specialist agents that run side by side, keeps the user informed of what each is doing, and keeps every change to the model visible and undoable per agent.

## ADDED Requirements

### Requirement: The team is defined in the project
The system SHALL read the agents of the open project from its Claude Code agent definitions (`.claude/agents/*.md`), each with a name, a description of what it does, its tools and its model. The first time the team is used in a project without definitions, the system SHALL create default definitions for Mochi (on Claude Sonnet), Architect, Product, Climate and Reviewer. It SHALL NOT overwrite definitions the project already has.

#### Scenario: Defaults created once
- **GIVEN** a project without agent definitions
- **WHEN** the first request is sent
- **THEN** definitions for mochi, architect, product, climate and reviewer exist in the project, and mochi's model is Sonnet

#### Scenario: User edits are kept
- **GIVEN** the project's architect definition was edited by the user
- **WHEN** the bridge restarts and the team is used again
- **THEN** the edited definition is unchanged

#### Scenario: A new specialist is routable
- **WHEN** the user adds an agent definition named "structure" with a description
- **THEN** after the next start the team includes Structure and Mochi can hand work to it

### Requirement: Mochi delegates to specialists
Every request SHALL go to Mochi. Mochi SHALL be able to hand a task (a title and an instruction) to a named specialist, and the hand-off SHALL return at once so Mochi stays available. Each specialist SHALL run as its own agent session with its own conversation, tools and model.

#### Scenario: Two specialists at once
- **WHEN** Mochi hands one task to Architect and one to Climate
- **THEN** both tasks run, each in its own session, and Mochi's turn ends without waiting for them

### Requirement: Work is scheduled safely
At most three agents SHALL run at the same time. At most one agent SHALL change the model at a time; a second agent that changes the model SHALL wait until the first has finished, while agents that only read SHALL run alongside. Each specialist task that changed the model SHALL be one undo step, labelled with the agent's name and the task title.

#### Scenario: Second writer queues
- **GIVEN** Architect is changing the model
- **WHEN** Mochi hands a model-changing task to Product
- **THEN** Product's task is shown as queued and starts when Architect's task ends

#### Scenario: One undo per specialist task
- **GIVEN** Architect's task created four columns
- **WHEN** the user presses undo once
- **THEN** the four columns are removed and the undo is labelled with Architect's task

### Requirement: Each agent only uses its own tools
The system SHALL know which agent makes each call to the app's scene tools and SHALL refuse calls to tools that agent is not allowed. Reviewer SHALL NOT be able to change the model.

#### Scenario: Reviewer cannot edit
- **WHEN** Reviewer tries to create, update or delete an element
- **THEN** the call is refused with a message that Reviewer does not change the model, and the model is unchanged

### Requirement: Status on demand
The user SHALL be able to ask Mochi for the team's status at any time, including while specialists are working, and Mochi SHALL answer from each agent's current state, current task, latest activity and place in the queue, without stopping their work.

#### Scenario: Status while working
- **GIVEN** Architect and Climate are working
- **WHEN** the user asks Mochi "what is everyone doing?"
- **THEN** Mochi answers naming both agents and their tasks, and both tasks keep running

### Requirement: Mochi reports finished work
When tasks Mochi handed out have finished, the system SHALL give Mochi each task's agent, outcome and summary, and Mochi SHALL report to the user without being asked.

#### Scenario: Report when done
- **GIVEN** Mochi handed tasks to Architect and Climate
- **WHEN** both tasks finish
- **THEN** Mochi posts a reply summarising both results

### Requirement: Tasks can be stopped
The user SHALL be able to stop one specialist's task, or everything, by click, by two open palms or by asking Mochi. A stopped task SHALL keep what it already changed as one undo step.

#### Scenario: Stop one task
- **GIVEN** Architect and Climate are working
- **WHEN** the user stops Architect's task
- **THEN** within 3 seconds Architect's task shows stopped and Climate keeps working

### Requirement: The team is visible in the agent panel
The agent panel SHALL show every agent with its state (idle, working, queued, waiting for approval) and current task, SHALL show Mochi's hand-offs as entries that open the specialist's own conversation, and SHALL name the agent on every tool call and approval card. The panel SHALL list the team's definitions and let the user add or edit an agent; a change SHALL apply from that agent's next task.

#### Scenario: Team strip follows the work
- **WHEN** Architect starts a task and Product's task is queued
- **THEN** the panel shows Architect as working with its task title and Product as queued

#### Scenario: Hand-off opens the specialist's conversation
- **WHEN** the user opens Mochi's hand-off to Architect
- **THEN** the panel shows Architect's conversation for that task, with its tool calls

### Requirement: Climate can study sun and shadow
Climate SHALL be able to set the viewer's sun for a date, a time and a location, and receive the sun's altitude and azimuth with a picture of the resulting view.

#### Scenario: Winter shadows
- **WHEN** Climate studies 21 December at 12:00 at latitude 51.5, longitude 0
- **THEN** the viewer's sun is set to an altitude of about 15 degrees from the south, and Climate receives that altitude and azimuth and a picture of the view
