# Spec Delta

## ADDED Requirements

### Requirement: Every element has a stable unique id
Every element in the scene SHALL have an id that is unique in the project and does not change for the life of the element, whoever creates it. When a creating agent gives no id the system SHALL make one. A create with an id that is already in use SHALL be refused, and the refusal SHALL name the element's owner when it has one.

#### Scenario: Two agents pick the same id
- **GIVEN** Architect created an element with id `dome-1`
- **WHEN** Product tries to create another element with id `dome-1`
- **THEN** the create is refused, nothing changes, and the message says `dome-1` already exists and belongs to Architect

#### Scenario: No id given
- **WHEN** an agent creates a wall without an id
- **THEN** the wall gets an id no other element has, and the reply lists it

### Requirement: Elements carry tags
Every element SHALL be able to carry tags: named text values, with names up to 64 characters, values up to 200 characters and at most 20 per element. Names starting with `hai.` SHALL be reserved for the system: `hai.owner` (the agent that created or last took over the element), `hai.part` (the part it belongs to) and `hai.source` (the object in an imported file it came from). Tags SHALL be saved with the project and be undoable like any other change. A project saved without tags SHALL load as before.

#### Scenario: Tags survive saving
- **GIVEN** a column with the tag `hai.part` = `hall`
- **WHEN** the project is saved and reopened
- **THEN** the column still has that tag

#### Scenario: Old project loads
- **WHEN** a project file written before tags existed is opened
- **THEN** it loads, every element has no tags, and nothing is rewritten until the next change

#### Scenario: Reserved names belong to the system
- **WHEN** an agent tries to set `hai.owner` to another agent's name by updating tags
- **THEN** the change is refused

### Requirement: What an agent creates is stamped with its name
An element created by an agent SHALL get the tag `hai.owner` with that agent's name, and, when the creating task has a part, the tag `hai.part`. An element created by the user SHALL get no owner.

#### Scenario: Created elements are stamped
- **GIVEN** Architect works on the part `dome`
- **WHEN** Architect creates two columns
- **THEN** both columns carry `hai.owner` = `architect` and `hai.part` = `dome`

### Requirement: Imported objects keep their source identity
An element made by importing a file SHALL carry the tag `hai.source` naming the file and the object's id in it, so the element can be matched to the object in Rhino and an object imported again can be recognised.

#### Scenario: Source recorded
- **WHEN** a `.3dm` with a box named "Hall" is imported
- **THEN** the new element has `hai.source` naming the file and the box's object id

### Requirement: The model can be read by owner, part and tag
The system SHALL let an agent list elements by owner, part or tag, and see a summary of how many elements each owner and part holds. The same tags on Rhino objects (their `hai.*` user strings) SHALL be listed the same way while Rhino is connected, so one question covers both.

#### Scenario: Ask what a part holds
- **GIVEN** the part `garden` holds six elements and `hall` holds ten
- **WHEN** an agent asks for the elements of part `garden`
- **THEN** it receives those six, with their ids and tags, and none of the others

#### Scenario: Summary by owner
- **WHEN** an agent reads the scene summary
- **THEN** it also sees the number of elements per owner, and the number with no owner
