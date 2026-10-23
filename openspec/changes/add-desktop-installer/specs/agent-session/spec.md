# Spec Delta

## MODIFIED Requirements

### Requirement: Claude Code installation and login are detected
Before starting a session, the system SHALL check that the `claude` CLI is installed, starts and has a logged-in user, using only the CLI's own commands (`claude --version` and `claude auth status`, from which only whether the user is logged in is read), and SHALL show a specific next step when a check fails. The checks SHALL run again whenever the page connects, so fixing the problem and reloading the page is enough. When `claude` is not found on the PATH, the system SHALL also look in the folder the official Claude Code installer uses for the current user, so a copy installed after the app started is found without restarting.

#### Scenario: CLI missing
- **WHEN** no `claude` executable is found
- **THEN** the agent panel says Claude Code is not installed and gives the address of its install instructions, and no request can be sent

#### Scenario: Not logged in
- **WHEN** the CLI reports that no account is logged in
- **THEN** the agent panel tells the user to run `claude` in a terminal, log in and reload the page, and no session starts

#### Scenario: CLI does not start
- **WHEN** `claude --version` fails
- **THEN** the agent panel says Claude Code is installed but did not start and suggests running `claude --version` in a terminal

#### Scenario: Installed but not on the PATH
- **GIVEN** `claude` is not on the PATH and an executable exists in the official installer's folder for the current user
- **WHEN** the checks run
- **THEN** that executable is used for the checks and for the session, and the panel does not report Claude Code as missing
