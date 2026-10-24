# Spec Delta

## MODIFIED Requirements

### Requirement: Work is scheduled safely
At most three specialists SHALL work at once, with Mochi always available on top; each agent SHALL work on one task at a time, and later tasks SHALL queue. While Parallel modelling is on, agents that change the model SHALL work at the same time only when their tasks' scopes do not overlap; a task whose scope overlaps a running task's, or that has no scope, SHALL queue until the overlap ends. While it is off, only one agent that changes the model SHALL work at a time. Agents that only read (Climate, Reviewer) SHALL work alongside in either case. Each specialist task SHALL be one undo step labelled with the agent's name and the task title, for example "Architect: Stair core", whether or not other tasks run at the same time.

#### Scenario: Second writer queues
- **GIVEN** Architect is changing the model with no scope and Parallel modelling is on
- **WHEN** Mochi hands a model-changing task to Product
- **THEN** Product's task is shown as queued and starts when Architect's task ends

#### Scenario: Disjoint writers run together
- **GIVEN** Architect's task claims the part `dome`
- **WHEN** Mochi hands Product a model-changing task that claims the part `hall`
- **THEN** both tasks run at the same time, each in its own session

#### Scenario: One undo per specialist task
- **GIVEN** Architect's task created four columns while Product's task created two walls at the same time
- **WHEN** the user presses undo once
- **THEN** only the task that ended last is reverted, as one step, and the other task's elements remain

## ADDED Requirements

### Requirement: Mochi hands out scoped tasks with a shared brief
The hand-off tool SHALL take, besides the agent, title and instruction, an optional scope and an optional brief shared by the tasks of one request. Mochi SHALL be told to split a request that spans separate parts of the model into tasks with scopes that do not overlap, to write the brief before handing out, and not to hand two tasks the same scope. A hand-off whose scope is invalid SHALL be refused with the reason.

#### Scenario: Overlap warned
- **WHEN** Mochi hands two tasks scopes that share an element id
- **THEN** both are accepted, the second shows as queued behind the first, and Mochi's reply says they overlap
