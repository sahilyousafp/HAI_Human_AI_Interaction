# Spec Delta

## MODIFIED Requirements

### Requirement: Scene tools are pre-approved
Calls to the system's own scene tools SHALL run without asking the user, because every scene change is visible and undoable. The system's open-data tools SHALL run without a card per call as well, because they are offered only while the user has switched Open data on, only for the listed sources, and send no model data; the switch and the list in Settings are the user's approval. A call to a tool of a user-installed extension, Ladybug Tools MCP included, SHALL NOT be pre-approved by this rule.

#### Scenario: Scene edit runs without a prompt
- **WHEN** the agent calls the create tool
- **THEN** no approval card is shown and the element is created

#### Scenario: Open-data call runs without a prompt
- **GIVEN** Open data is on
- **WHEN** an agent asks for the weather now
- **THEN** no approval card is shown and the result is returned

#### Scenario: Open data off means no tool
- **GIVEN** Open data is off
- **WHEN** an agent lists its tools
- **THEN** no open-data tool is offered, so none can be called

#### Scenario: Extension tool still asks
- **GIVEN** Ladybug Tools MCP is installed
- **WHEN** Simulation calls one of its tools
- **THEN** an approval card is shown and the turn waits

## ADDED Requirements

### Requirement: Nothing from the project leaves through a tool
No tool the system provides SHALL send model geometry, element or project names, file paths, camera images or the conversation to any host other than the user's own agent. A proposal to set the site SHALL show an approval card with its values before anything is saved.

#### Scenario: Open-data request content
- **WHEN** an agent asks for buildings around the site
- **THEN** the only data in the request that comes from the project is the site's coordinates and the radius the agent gave

#### Scenario: Site proposal asks
- **WHEN** an agent proposes a site
- **THEN** an approval card shows the coordinates and the north angle, and the site is saved only after the user allows it
