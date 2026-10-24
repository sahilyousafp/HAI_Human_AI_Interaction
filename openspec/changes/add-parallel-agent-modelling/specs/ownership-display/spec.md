# Spec Delta

## ADDED Requirements

### Requirement: The model shows who owns what
The viewer SHALL show each element that has an owner with an outline or tint in that agent's colour, and SHALL do the same for mirrored Rhino objects that carry `hai.owner`. Selection, hover and the pending-deletion mark SHALL stay clearly visible over the owner colour. The display SHALL follow a change of owner within 200 ms of the change reaching the viewer.

#### Scenario: Owned elements are tinted
- **GIVEN** Architect owns two columns and Product owns a wall
- **WHEN** the viewer draws the model
- **THEN** the columns show Architect's colour and the wall shows Product's

#### Scenario: Selection stays on top
- **WHEN** the user selects one of Architect's columns
- **THEN** it shows the selection colour, not the owner colour

#### Scenario: Rhino objects too
- **GIVEN** Rhino is connected and an object carries `hai.owner` = `product`
- **WHEN** the viewer draws it
- **THEN** it shows Product's colour

### Requirement: A claim is visible in the model
While a task has a claim, the viewer SHALL mark the claimed scope: a translucent box in the agent's colour for a region, and the owner display on the elements of an id or part scope. The mark SHALL disappear within 200 ms of the claim ending.

#### Scenario: Region box
- **WHEN** Architect's task claims a region
- **THEN** a translucent box in Architect's colour marks it until the task ends

### Requirement: Who is working on which part can be read at a glance
The agent panel SHALL list the running claims: agent, task title, scope (part, region, or number of elements) and the number of elements held. Hovering a claim SHALL highlight its elements in the viewer. A queued task that waits on a claim SHALL say which claim it waits for. The same information SHALL be in the team strip's chips.

#### Scenario: Hover a claim
- **GIVEN** Product's claim lists the part `hall`
- **WHEN** the user hovers it in the panel
- **THEN** the elements of `hall` are highlighted in the viewer

#### Scenario: Waiting reason
- **GIVEN** Product's task is queued behind Architect's claim
- **WHEN** the panel is shown
- **THEN** Product's chip says it waits for Architect's task

### Requirement: Showing owners can be switched off
Settings SHALL have **Parallel modelling** to turn the whole feature on or off (off means one writer at a time and no owner display) and **Show owners** to turn the owner tint and claim boxes off while keeping parallel work. Both SHALL be kept with the workspace.

#### Scenario: Show owners off
- **GIVEN** Show owners is off
- **WHEN** two agents work at the same time
- **THEN** no owner tint or claim box is drawn, and the panel still lists the claims
