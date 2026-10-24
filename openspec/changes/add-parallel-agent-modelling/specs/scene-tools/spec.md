# Spec Delta

## MODIFIED Requirements

### Requirement: Agent can read the scene
The scene tools SHALL let the agent get a compact scene summary (levels, element counts by type, counts by owner and by part, bounding box), get full details for elements by id, by type and level, or by owner, part or tag, and read the current selection. Details SHALL include each element's tags.

#### Scenario: Summary of the sample scene
- **WHEN** the agent calls the summary tool on the sample scene
- **THEN** it receives the levels, the count of each element type, the counts by owner and part, and the overall bounding box in millimetres

#### Scenario: Filter by part
- **WHEN** the agent asks for the elements of part `garden`
- **THEN** it receives only those elements

### Requirement: Agent can create, update and delete elements
The scene tools SHALL let the agent create, update and delete elements in batches, change their tags, and set the selection for everyone. The tools SHALL know which agent is calling and SHALL check every change against that agent's claim. Every input SHALL be validated against the scene schema, and an invalid or unclaimed batch SHALL change nothing and return an error that names the invalid element and field, or the claim that refuses it.

#### Scenario: Invalid batch is atomic
- **WHEN** the agent submits a batch of three walls where one has zero height
- **THEN** no wall is created and the error names the invalid wall and the height field

#### Scenario: Unclaimed batch is atomic
- **WHEN** the agent submits a batch where one element belongs to another running task's claim
- **THEN** nothing is changed and the error names that element and the task that claims it

### Requirement: One agent turn is one undoable transaction
All scene changes made by one agent during one task or turn SHALL form a single transaction labelled with what it was asked to do, so a single undo reverts that agent's whole work, even while other agents work at the same time. The user SHALL see each change in the model as it is made.

#### Scenario: Undo a whole turn
- **GIVEN** an agent turn that created four columns and moved a wall
- **WHEN** the user presses undo once
- **THEN** the four columns are removed and the wall returns to its previous position

## ADDED Requirements

### Requirement: Agents can see and manage claims
The scene tools SHALL let every agent read the running claims and the shared brief, ask for more scope for its own task, give scope back, and read what the user changed in its scope since it last looked.

#### Scenario: Read claims
- **GIVEN** Architect and Product each hold a claim
- **WHEN** Climate reads the claims
- **THEN** it receives both, with agent, task, scope and element count
