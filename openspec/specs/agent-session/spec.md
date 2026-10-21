# agent-session Specification

## Purpose
Runs the user's own Claude, from their own Claude Code installation and login, as a long-lived conversational session that the interface can talk to, interrupt and recover, without ever handling the user's credentials.

## Requirements

### Requirement: Claude Code installation and login are detected
Before starting a session, the system SHALL check that the `claude` CLI is installed, starts and has a logged-in user, using only the CLI's own commands (`claude --version` and `claude auth status`, from which only whether the user is logged in is read), and SHALL show a specific next step when a check fails. The checks SHALL run again whenever the page connects, so fixing the problem and reloading the page is enough.

#### Scenario: CLI missing
- **WHEN** no `claude` executable is found
- **THEN** the agent panel says Claude Code is not installed and gives the address of its install instructions, and no request can be sent

#### Scenario: Not logged in
- **WHEN** the CLI reports that no account is logged in
- **THEN** the agent panel tells the user to run `claude` in a terminal, log in and reload the page, and no session starts

#### Scenario: CLI does not start
- **WHEN** `claude --version` fails
- **THEN** the agent panel says Claude Code is installed but did not start and suggests running `claude --version` in a terminal

### Requirement: Credentials are never read, stored or forwarded
The system SHALL NOT read, copy, store, log or transmit Claude credential files, OAuth tokens or API keys, and SHALL NOT modify the `claude` executable or its requests. It SHALL only start the unmodified CLI and exchange messages over its standard input and output.

#### Scenario: No credential access in code
- **WHEN** the repository's credential-boundary check runs in CI
- **THEN** no source file outside tests references Claude credential file paths or token environment variables

#### Scenario: Logs contain no secrets
- **GIVEN** a full agent turn has run
- **WHEN** bridge logs are searched
- **THEN** they contain no credential values, authorization headers or bridge tokens

### Requirement: One long-lived session serves many turns
The system SHALL keep one long-lived process per agent in the open project, started when that agent first has work, and send each request to it as a new turn, instead of starting a new process per request. Opening another project SHALL start that project's own conversations.

#### Scenario: Second turn reuses the process
- **WHEN** the user sends two requests in a row
- **THEN** both are answered by the same agent process and the second can refer to the first

### Requirement: Session survives reloads and crashes
The conversation SHALL survive a browser reload: the panel SHALL show the last 50 turns again. Each agent's conversation id SHALL be kept in the project (`.aex/agent/<name>/session.json`), so that after the agent process exits unexpectedly, is closed after 20 idle minutes, or the bridge restarts, the next turn starts a new process that resumes the same conversation. After an unexpected exit, that turn SHALL tell the user the session recovered.

#### Scenario: Browser reload
- **GIVEN** a conversation with two turns
- **WHEN** the browser tab reloads
- **THEN** the agent panel shows both turns and the next request continues the conversation

#### Scenario: Agent process crash
- **GIVEN** a running session
- **WHEN** the agent process is killed
- **THEN** the next request is answered in the same conversation and the panel shows a "Session recovered" notice

### Requirement: A running turn can be stopped
The user SHALL be able to stop a running turn. Stopping SHALL send Claude Code's interrupt request and, if the turn has not ended within 1.5 seconds, end the agent process so the next turn resumes the conversation. Either way the turn SHALL end within 3 seconds, keep the changes already made in it as one undoable transaction, deny its waiting approval cards, and leave the session ready for the next request.

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
