# Spec Delta

## Purpose

Ensures only the user's own app on the same machine can reach the bridge and the agent behind it, so no other website or device can drive the agent or read the model.

## ADDED Requirements

### Requirement: Bridge listens on loopback only
The bridge SHALL accept connections only on the loopback interface (127.0.0.1) and SHALL refuse to start if configured with any other address.

#### Scenario: Non-loopback address refused
- **WHEN** the bridge is configured to listen on 0.0.0.0
- **THEN** it exits with an error explaining that only loopback is allowed

### Requirement: Connections require the session token and an allowed origin
Every WebSocket connection SHALL present the session token generated at bridge start and an Origin from the allow-list, or it SHALL be rejected.

#### Scenario: Foreign web page rejected
- **WHEN** a page served from another origin opens a WebSocket to the bridge with no token
- **THEN** the connection is rejected and nothing is exchanged

#### Scenario: Wrong token rejected
- **WHEN** a connection presents an incorrect token from an allowed origin
- **THEN** the connection is rejected

### Requirement: The MCP endpoint requires the session token
The bridge's MCP endpoint SHALL require the session token on every request and SHALL respond with an authentication error otherwise.

#### Scenario: MCP request without token
- **WHEN** an HTTP request reaches the MCP endpoint without the token
- **THEN** it receives an authentication error and no tool runs
