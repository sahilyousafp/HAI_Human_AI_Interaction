# Spec Delta

## Purpose

Lets the user see and extend what their agent can use, its MCP servers and skills, from inside the app, while their existing Claude Code setup keeps working unchanged.

## ADDED Requirements

### Requirement: Loaded MCP servers and skills are visible
The system SHALL show every MCP server loaded in the current session with its scope (user or project) and connection status, and every available skill with its name, description and scope.

#### Scenario: Failed server is shown
- **GIVEN** a configured MCP server that fails to start
- **WHEN** the session starts
- **THEN** the extensions view lists it with a failed status and the error reported by the session

### Requirement: Project MCP servers can be added and removed
The user SHALL be able to add an MCP server to the open project (stdio command with arguments and environment variables, or an HTTP URL with headers) and remove one, using Claude Code's own project-scoped configuration so the same server also works when the user runs Claude Code directly in that folder.

#### Scenario: Add a stdio server
- **WHEN** the user adds a stdio server with a name, command and arguments
- **THEN** the project's MCP configuration contains it and, after the session restarts, it appears in the loaded server list

#### Scenario: Remove a server
- **WHEN** the user removes a project MCP server
- **THEN** it no longer appears in the project configuration or, after restart, in the loaded list

### Requirement: Project skills can be installed and removed
The user SHALL be able to install a skill into the open project from a local folder or a git repository URL, and remove it. A skill without a valid `SKILL.md` (name and description) SHALL be rejected with a reason.

#### Scenario: Install from folder
- **WHEN** the user installs a skill from a folder containing a valid `SKILL.md`
- **THEN** it is copied into the project's skills folder and, after restart, appears in the skill list

#### Scenario: Invalid skill rejected
- **WHEN** the user installs from a folder with no `SKILL.md`
- **THEN** installation fails with a message saying `SKILL.md` is missing and nothing is copied

### Requirement: Changes apply without losing the conversation
After an extension change, the system SHALL restart the agent session and resume the same conversation, and SHALL tell the user the change is now active.

#### Scenario: Conversation continues after adding a server
- **GIVEN** a conversation with one turn
- **WHEN** the user adds a project MCP server
- **THEN** the next request continues the same conversation and the new server's tools are available

### Requirement: Secrets in server configuration are masked
Environment variable values and header values entered for MCP servers SHALL be masked in the interface and SHALL NOT appear in bridge logs.

#### Scenario: Masked header
- **WHEN** the user adds an HTTP server with an authorization header
- **THEN** the extensions view shows the header name with a masked value and the logs do not contain the value
