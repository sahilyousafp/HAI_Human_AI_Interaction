# Spec Delta

## ADDED Requirements

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
