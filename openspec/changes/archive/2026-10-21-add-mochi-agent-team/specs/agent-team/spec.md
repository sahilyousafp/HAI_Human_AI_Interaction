# Spec Delta

## Purpose

Lets one lead agent, Mochi, turn the user's requests into work for specialist agents that run side by side, keeps the user informed of what each is doing, and keeps every change to the model visible and undoable per agent.

## ADDED Requirements

### Requirement: The team is defined in the project
The system SHALL read the open project's agents from its Claude Code agent definitions (`.claude/agents/*.md`: name, description, tools, model) and AEX's extra details from `.aex/agents.json`, again before every request and task. On the first request in a project it SHALL create the missing default definitions (Mochi, the lead, Architect, Product, Climate, Reviewer, all on Claude Sonnet) without overwriting existing ones. A project's earlier single conversation SHALL become Mochi's.

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
- **THEN** from Mochi's next request the team includes Structure and Mochi can hand work to it

#### Scenario: Earlier conversation continues with Mochi
- **GIVEN** a project with a conversation from before the team existed
- **WHEN** the first request is sent to the team
- **THEN** Mochi resumes that conversation

### Requirement: Mochi delegates to specialists
Every request SHALL go to Mochi, which answers questions itself and hands design work on. Mochi SHALL be able to hand a task (a title and an instruction) to a named specialist, and the hand-off SHALL return at once so Mochi's turn ends and Mochi stays available. Each specialist SHALL run as its own agent session with its own conversation, tools and model. A hand-off to an agent the project does not have SHALL be refused with the team's names.

#### Scenario: Two specialists at once
- **WHEN** Mochi hands one task to Architect and one to Climate
- **THEN** both tasks run, each in its own session, and Mochi's turn ends without waiting for them

### Requirement: Work is scheduled safely
At most three specialists SHALL work at once, with Mochi always available on top; each agent SHALL work on one task at a time, and later tasks SHALL queue. Only one agent that changes the model SHALL work at a time, while agents that only read (Climate, Reviewer) SHALL work alongside. Each specialist task SHALL be one undo step labelled with the agent's name and the task title, for example "Architect: Stair core".

#### Scenario: Second writer queues
- **GIVEN** Architect is changing the model
- **WHEN** Mochi hands a model-changing task to Product
- **THEN** Product's task is shown as queued and starts when Architect's task ends

#### Scenario: One undo per specialist task
- **GIVEN** Architect's task created four columns
- **WHEN** the user presses undo once
- **THEN** the four columns are removed and the undo is labelled with Architect's task

### Requirement: Each agent only uses its own tools
Each agent process SHALL reach the app's tool server with its own token, from which the system SHALL know which agent is calling and SHALL offer it only the app tools its definition lists. An agent not marked as changing the model SHALL never be offered the tools that change it, whatever its definition lists. Reviewer SHALL NOT be able to change the model.

#### Scenario: Reviewer cannot edit
- **WHEN** Reviewer tries to create, update or delete an element
- **THEN** the call is refused, because the app's tool server offers Reviewer no tools that change the model, and the model is unchanged

### Requirement: Status on demand
The user SHALL be able to ask Mochi for the team's status at any time, including while specialists are working, and Mochi SHALL answer from each agent's current state, current task, latest activity and place in the queue, without stopping their work.

#### Scenario: Status while working
- **GIVEN** Architect and Climate are working
- **WHEN** the user asks Mochi "what is everyone doing?"
- **THEN** Mochi answers naming both agents and their tasks, and both tasks keep running

### Requirement: Mochi reports finished work
When every task Mochi handed out in one turn has finished, the system SHALL give Mochi each task's agent, outcome and the specialist's summary, and Mochi SHALL report to the user without being asked. A report SHALL wait while the user's own turn with Mochi runs, and SHALL NOT follow Stop all.

#### Scenario: Report when done
- **GIVEN** Mochi handed tasks to Architect and Climate
- **WHEN** both tasks finish
- **THEN** Mochi posts a reply summarising both results

### Requirement: Tasks can be stopped
The user SHALL be able to stop one specialist's task with its Stop control or by asking Mochi, and everything with Stop all, the stop button or two open palms. Stopping everything SHALL stop Mochi's turn, every running task and the queue. A stopped task SHALL end within 3 seconds and keep what it already changed as one undo step; a queued task SHALL be taken off the queue.

#### Scenario: Stop one task
- **GIVEN** Architect and Climate are working
- **WHEN** the user stops Architect's task
- **THEN** within 3 seconds Architect's task shows stopped and Climate keeps working

### Requirement: The team is visible in the agent panel
The agent panel SHALL be Mochi's chat, with Mochi's name and state in its header. A team strip SHALL show each specialist's state (idle, working, queued, needs approval) and current task, in one compact row while all are idle. Mochi's hand-offs SHALL appear as chips with live status that open the specialist's conversation for that task. Every tool call and approval card SHALL name the agent, and a specialist's waiting approval card SHALL also appear under its hand-off chip in Mochi's chat.

#### Scenario: Team strip follows the work
- **WHEN** Architect starts a task and Product's task is queued
- **THEN** the panel shows Architect as working with its task title and Product as queued

#### Scenario: Hand-off opens the specialist's conversation
- **WHEN** the user opens Mochi's hand-off to Architect
- **THEN** the panel shows Architect's conversation for that task, with its tool calls

#### Scenario: Specialist's approval waits in Mochi's chat
- **WHEN** Architect's task needs an approval
- **THEN** the card names Architect and appears under Architect's hand-off chip in Mochi's chat, and a nod allows it

### Requirement: The Agents tab edits the team
The agent panel's Agents tab SHALL list the team's definitions with each agent's model, what it does and whether it changes the model, and SHALL let the user add or edit an agent: name, what it does, model, what it may do, other Claude Code tools, instructions, other names and colour. A name already in the team SHALL be refused before saving. A change SHALL apply from that agent's next task.

#### Scenario: Add an agent Mochi can use
- **WHEN** the user adds an agent in the Agents tab
- **THEN** it is written to the project's agent definitions and Mochi can hand work to it from Mochi's next request

#### Scenario: Name already taken
- **WHEN** the user adds an agent with the name of an existing agent
- **THEN** it is refused before saving and nothing is written

### Requirement: Climate can study sun and shadow
Climate SHALL be able to set the viewer's sun for a date, a local time and a location (north is +Y; the local time follows the longitude unless an offset from UTC is given), and receive the sun's altitude and azimuth with a picture of the resulting view. The viewer SHALL show a Sun study badge until the user presses Escape, closes it or picks another tool, which restores the normal light.

#### Scenario: Winter shadows
- **WHEN** Climate studies 21 December at 12:00 at latitude 51.5, longitude 0
- **THEN** the viewer's sun is set to an altitude of about 15 degrees from the south, and Climate receives that altitude and azimuth and a picture of the view

#### Scenario: Back to normal light
- **GIVEN** a sun study is shown
- **WHEN** the user presses Escape
- **THEN** the Sun study badge disappears and the normal light returns
