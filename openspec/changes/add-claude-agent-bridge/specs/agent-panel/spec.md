# Spec Delta

## Purpose

Gives the user one place in the HUD to talk to their agent, watch what it is doing, decide on approvals and stop it.

## ADDED Requirements

### Requirement: Replies stream as they are written
The agent panel SHALL show the agent's reply text incrementally as it is produced, and SHALL mark the turn complete when the agent finishes.

#### Scenario: Streaming reply
- **WHEN** the agent answers a request
- **THEN** reply text appears in several increments before the turn is marked complete

### Requirement: Tool activity is shown compactly
Each tool call SHALL appear in the turn as a compact chip with the tool name and outcome (running, done, failed, denied). Expanding a chip SHALL show its input and result summary.

#### Scenario: Failed tool call
- **WHEN** a scene tool call fails validation
- **THEN** its chip shows failed and expanding it shows the error message

### Requirement: Agent status is always visible
The panel SHALL show the session status: not available (with reason), starting, idle, working or recovering.

#### Scenario: Working status
- **WHEN** a turn is running
- **THEN** the status shows working until the turn completes or is stopped

### Requirement: Typed requests are always possible
The panel SHALL accept typed requests, sent with Enter, at any time the session is idle.

#### Scenario: Send typed request
- **GIVEN** the session is idle
- **WHEN** the user types a request and presses Enter
- **THEN** the request appears in the transcript and a turn starts

### Requirement: Stop is reachable by click and by gesture
The panel SHALL offer a stop control while a turn runs, and holding both open palms toward the camera for 500 ms SHALL also stop the turn.

#### Scenario: Two-palm stop
- **GIVEN** a running turn and the system is engaged
- **WHEN** both open palms face the camera for 500 ms
- **THEN** the turn stops
