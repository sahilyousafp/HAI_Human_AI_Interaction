# Spec Delta

## MODIFIED Requirements

### Requirement: Scene supports basic architectural elements
The scene SHALL support element types massing, slab, wall, column and imported, each with a stable unique id, a name, an optional level, optional tags, type-specific dimensions and free-form properties. Loading SHALL reject a scene whose elements have invalid dimensions or tags, refer to a level that does not exist, or are stored under a key that differs from their id.

#### Scenario: Element types load
- **WHEN** the sample scene is loaded
- **THEN** it contains at least one element of each of massing, slab, wall and column, each with a unique id

#### Scenario: Invalid element is rejected
- **WHEN** a scene file contains a wall with a negative thickness
- **THEN** loading fails with an error naming the element id and the invalid field, and the current scene is unchanged

#### Scenario: Invalid tag is rejected
- **WHEN** a scene file contains an element with a tag value over 200 characters
- **THEN** loading fails with an error naming the element id and the tag

### Requirement: All edits are undoable transactions
Every change to the scene SHALL happen inside a transaction with a label. A transaction SHALL apply completely or not at all. Undo SHALL revert a whole transaction and redo SHALL reapply it; a new transaction SHALL clear redo. Changes made by several agents at the same time SHALL each be grouped into that agent's own transaction, labelled with the agent's task, and recorded as one undo step when that agent's task ends. Every change sent to clients SHALL say who made it: the user, or the agent's name.

#### Scenario: Multi-element transaction undoes at once
- **GIVEN** one transaction that moves three columns
- **WHEN** the user undoes once
- **THEN** all three columns return to their previous positions

#### Scenario: Invalid transaction changes nothing
- **WHEN** a client sends a transaction with an invalid operation
- **THEN** the scene is unchanged, no client receives a change, and only the sender receives an error

#### Scenario: Two agents, two steps
- **GIVEN** Architect and Product change disjoint elements at the same time
- **WHEN** both tasks have ended
- **THEN** the history has one step per agent, each labelled with its agent and task, and undoing one leaves the other's elements as they are

#### Scenario: Author on every change
- **WHEN** Architect creates a column
- **THEN** every client receives the change marked as made by Architect

#### Scenario: Undo while agents work
- **GIVEN** Architect and Product are working
- **WHEN** the user presses undo
- **THEN** what each agent has done so far is recorded as a step, each agent carries on in a new step with the same label, and the newest step is undone
