# Spec Delta

## Purpose

Keeps the user in charge of what their agent may do: any tool call that is not pre-approved is shown to the user, who decides with a click or a head gesture.

## ADDED Requirements

### Requirement: Scene tools are pre-approved
Calls to the system's own scene tools SHALL run without asking the user, because every scene change is visible and undoable.

#### Scenario: Scene edit runs without a prompt
- **WHEN** the agent calls the create tool
- **THEN** no approval card is shown and the element is created

### Requirement: Other tool calls ask the user
Any tool call that is not pre-approved SHALL pause and show an approval card naming the tool, the server or source it comes from, and a readable summary of its input.

#### Scenario: Shell command needs approval
- **WHEN** the agent tries to run a shell command
- **THEN** an approval card appears with the command text and the turn waits

### Requirement: Approval by click, nod or shake
The user SHALL be able to allow a pending call by clicking Allow or nodding, and deny it by clicking Deny or shaking their head. Head gestures SHALL only decide a card while it is the only pending card.

#### Scenario: Nod allows
- **GIVEN** one pending approval card and the system is engaged
- **WHEN** the user nods
- **THEN** the call is allowed and the card shows "Allowed"

#### Scenario: Shake denies
- **GIVEN** one pending approval card
- **WHEN** the user shakes their head
- **THEN** the call is denied, the agent is told the user declined, and the card shows "Denied"

### Requirement: Unanswered requests are denied
A pending approval SHALL be denied automatically after 60 seconds, and the card SHALL say it timed out.

#### Scenario: Timeout
- **WHEN** an approval card is left unanswered for 60 seconds
- **THEN** the call is denied and the card shows "Timed out"

### Requirement: Always allow per project
The user SHALL be able to choose "Always allow" for a tool, which pre-approves that tool for the current project until revoked in settings.

#### Scenario: Remembered approval
- **GIVEN** the user chose "Always allow" for a web search tool
- **WHEN** the agent calls it again, even after a restart
- **THEN** no approval card is shown

#### Scenario: Revoke
- **WHEN** the user removes that tool from the project's always-allowed list
- **THEN** the next call shows an approval card again
