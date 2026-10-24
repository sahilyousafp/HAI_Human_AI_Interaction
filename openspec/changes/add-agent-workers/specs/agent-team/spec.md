# Spec Delta

## MODIFIED Requirements

### Requirement: Work is scheduled safely
At most three specialists SHALL work at once, with Mochi always available on top; each agent SHALL work on one task at a time, and later tasks SHALL queue. Workers a specialist starts SHALL count toward the number of sessions running at once, which is limited by a setting (6 by default). While Parallel modelling is on, agents that change the model SHALL work at the same time only when their tasks' scopes do not overlap; a task whose scope overlaps a running task's, or that has no scope, SHALL queue until the overlap ends. While it is off, only one agent that changes the model SHALL work at a time, and no workers SHALL be started. Agents that only read (Climate, Reviewer) SHALL work alongside in either case. Each specialist task SHALL be one undo step labelled with the agent's name and the task title, and each worker's work its own step.

#### Scenario: Second writer queues
- **GIVEN** Architect is changing the model with no scope and Parallel modelling is on
- **WHEN** Mochi hands a model-changing task to Product
- **THEN** Product's task is shown as queued and starts when Architect's task ends

#### Scenario: One undo per specialist task
- **GIVEN** Architect's task created four columns
- **WHEN** the user presses undo once
- **THEN** the four columns are removed and the undo is labelled with Architect's task

#### Scenario: Workers count toward the limit
- **GIVEN** the session limit is 3 and Architect, Product and one worker run
- **WHEN** a specialist starts another worker
- **THEN** it is queued until a session ends

#### Scenario: No workers without Parallel modelling
- **GIVEN** Parallel modelling is off
- **WHEN** a specialist tries to start a worker
- **THEN** the request is refused and says Parallel modelling is off

### Requirement: Tasks can be stopped
The user SHALL be able to stop one specialist's task with its Stop control or by asking Mochi, and everything with Stop all, the stop button or two open palms. Stopping a task SHALL stop its workers, and stopping everything SHALL stop Mochi's turn, every running task, every worker and the queue. A stopped task or worker SHALL end within 3 seconds and keep what it already changed as one undo step; a queued task or worker SHALL be taken off the queue.

#### Scenario: Stop one task
- **GIVEN** Architect and Climate are working
- **WHEN** the user stops Architect's task
- **THEN** within 3 seconds Architect's task shows stopped and Climate keeps working

#### Scenario: Stop takes the workers
- **GIVEN** Architect has two workers
- **WHEN** the user stops Architect's task
- **THEN** all three show stopped within 3 seconds
