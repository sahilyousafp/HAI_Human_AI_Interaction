# local-access-control Specification

## Purpose
Ensures only the user's own app on the same machine can reach the bridge and the agent behind it, so no other website or device can drive the agent or read the model.

## Requirements

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

### Requirement: The MCP endpoint requires an agent's own token
Each agent process SHALL receive its own random token for the bridge's MCP endpoint, written into its generated MCP configuration and replaced each time the process starts. The endpoint SHALL require such a token as a bearer token on every request, SHALL only accept requests addressed to localhost and, when an Origin is sent, from the allow-list, and SHALL respond with an authentication error otherwise. The browsers' session token SHALL NOT be accepted there.

#### Scenario: MCP request without token
- **WHEN** an HTTP request reaches the MCP endpoint without a token
- **THEN** it receives an authentication error and no tool runs

#### Scenario: Session token refused
- **WHEN** an HTTP request reaches the MCP endpoint with the browsers' session token
- **THEN** it receives an authentication error and no tool runs

### Requirement: Local non-browser clients connect with the token only
A connection without an Origin header SHALL be accepted only when it presents the session token and identifies itself as a supported local client (the Rhino plugin). Browsers always send an Origin, so this cannot be used by web pages.

#### Scenario: Rhino plugin connects
- **WHEN** the Rhino plugin connects with the session token and no Origin
- **THEN** the connection is accepted with the Rhino client role

#### Scenario: Token-less local client rejected
- **WHEN** a local process connects with no Origin and no token
- **THEN** the connection is rejected

### Requirement: Local clients discover the bridge from the user profile
The bridge SHALL write its port and token to a discovery file in the current user's local application data folder, readable only by that user, and SHALL delete it on shutdown.

#### Scenario: Discovery file lifecycle
- **WHEN** the bridge starts and later shuts down cleanly
- **THEN** the discovery file exists with the current port and token while it runs and is gone after shutdown
