# Spec Delta

## Purpose

Runs the user's own Claude, from their own Claude Code installation and login, as a long-lived conversational session that the interface can talk to, interrupt and recover, without ever handling the user's credentials.

## ADDED Requirements

### Requirement: Claude Code installation and login are detected
Before starting a session, the system SHALL check that the `claude` CLI is installed and that the user is logged in, using the CLI's own status commands, and SHALL show a specific next step when either check fails.

#### Scenario: CLI missing
- **WHEN** no `claude` executable is found
- **THEN** the agent panel says Claude Code is not installed and links to its install instructions, and no session starts

#### Scenario: Not logged in
- **WHEN** the CLI reports that no account is logged in
- **THEN** the agent panel tells the user to run `claude` in a terminal and log in, and no session starts

### Requirement: Credentials are never read, stored or forwarded
The system SHALL NOT read, copy, store, log or transmit Claude credential files, OAuth tokens or API keys, and SHALL NOT modify the `claude` executable or its requests. It SHALL only start the unmodified CLI and exchange messages over its standard input and output.

#### Scenario: No credential access in code
- **WHEN** the repository's credential-boundary check runs in CI
- **THEN** no source file outside tests references Claude credential file paths or token environment variables

#### Scenario: Logs contain no secrets
- **GIVEN** a full agent turn has run
- **WHEN** bridge logs are searched
- **THEN** they contain no credential values or authorization headers

### Requirement: One long-lived session serves many turns
The system SHALL keep one agent process per open project and send each user request to it as a new turn, instead of starting a new process per request.

#### Scenario: Second turn reuses the process
- **WHEN** the user sends two requests in a row
- **THEN** both are answered by the same agent process and the second can refer to the first

### Requirement: Session survives reloads and crashes
The conversation SHALL survive a browser reload. If the agent process exits unexpectedly, the system SHALL start a new process that resumes the same conversation and SHALL tell the user it recovered.

#### Scenario: Browser reload
- **GIVEN** a conversation with two turns
- **WHEN** the browser tab reloads
- **THEN** the agent panel shows both turns and the next request continues the conversation

#### Scenario: Agent process crash
- **GIVEN** a running session
- **WHEN** the agent process is killed
- **THEN** the next request is answered in the same conversation and the panel shows a "session recovered" notice

### Requirement: A running turn can be stopped
The user SHALL be able to stop a running turn. Stopping SHALL end the turn within 3 seconds, keep the changes already made in that turn as one undoable transaction, and leave the session ready for the next request.

#### Scenario: Stop mid-turn
- **GIVEN** the agent is executing tool calls
- **WHEN** the user activates stop
- **THEN** within 3 seconds the panel shows the turn as stopped and accepts a new request

### Requirement: The user's own Claude Code setup applies
The session SHALL load the user's Claude Code user-level and project-level settings, MCP servers and skills, in addition to the system's own scene tools, and SHALL run with the open project folder as its working directory.

#### Scenario: User MCP server available
- **GIVEN** the user has a user-level MCP server configured in Claude Code
- **WHEN** a session starts
- **THEN** that server appears in the session's loaded server list alongside the scene tools

### Requirement: The agent knows the design context
Each session SHALL receive a system prompt addition that states the scene units (millimetres), the axis convention (Z up), which tools act on the scene, and that the user may refer to elements by pointing or selecting.

#### Scenario: Units honoured
- **WHEN** the user asks for "a wall 3 m high"
- **THEN** the created wall has a height of 3000 in the scene
