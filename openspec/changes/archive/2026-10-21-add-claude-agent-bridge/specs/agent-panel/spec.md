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
Each tool call SHALL appear in the turn as a compact chip with the tool name, its MCP server if any, and its outcome (running, needs approval, done, failed, denied). Expanding a chip SHALL show its input and its result or error.

#### Scenario: Failed tool call
- **WHEN** a scene tool call fails validation
- **THEN** its chip shows failed and expanding it shows the error message

### Requirement: Agent status is always visible
The panel SHALL show the session status: Unavailable (with the reason and what to do), Starting, Ready, Working or Recovering.

#### Scenario: Working status
- **WHEN** a turn is running
- **THEN** the status shows Working until the turn completes or is stopped

### Requirement: Typed requests are always possible
The panel SHALL accept typed requests next to the microphone, sent with Enter (Shift+Enter adds a line), whenever the agent is Ready. While the agent works, the send button SHALL become the stop control.

#### Scenario: Send typed request
- **GIVEN** the agent is Ready
- **WHEN** the user types a request and presses Enter
- **THEN** the request appears in the transcript and a turn starts

### Requirement: Stop is reachable by click and by gesture
The panel SHALL offer a stop control while the agent works, and holding both open palms toward the camera for 500 ms while engaged SHALL also stop it. A stopped turn SHALL say that its changes so far are kept as one undo step.

#### Scenario: Two-palm stop
- **GIVEN** a running turn and the system is engaged
- **WHEN** both open palms face the camera for 500 ms
- **THEN** the turn stops

### Requirement: The panel can be collapsed
The user SHALL be able to collapse the panel to its header and expand it again; the choice SHALL be remembered across reloads. While collapsed, the header SHALL show how many approvals are waiting.

#### Scenario: Collapsed panel stays collapsed
- **GIVEN** the user collapsed the panel
- **WHEN** the page reloads
- **THEN** the panel shows only its header

#### Scenario: Waiting approvals while collapsed
- **GIVEN** the panel is collapsed
- **WHEN** an approval card is waiting
- **THEN** the header shows "1 to approve"
