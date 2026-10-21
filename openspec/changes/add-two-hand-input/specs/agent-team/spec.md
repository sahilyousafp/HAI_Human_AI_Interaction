## MODIFIED Requirements

### Requirement: Tasks can be stopped
The user SHALL be able to stop one specialist's task with its Stop control or by asking Mochi. The user SHALL be able to stop everything with Stop all, the stop button, or both fists followed by open hands. Stopping everything SHALL stop Mochi's turn, every running task and the queue. A stopped task SHALL end within 3 seconds and keep what it already changed as one undo step. A queued task SHALL be taken off the queue.

#### Scenario: Stop one task
- **GIVEN** Architect and Climate are working
- **WHEN** the user stops Architect's task
- **THEN** within 3 seconds Architect's task shows stopped and Climate keeps working

#### Scenario: Stop everything by hand
- **GIVEN** Mochi and Architect are working
- **WHEN** the user clenches both hands into fists and then opens them toward the camera
- **THEN** Mochi's turn and Architect's task stop, and no report follows
