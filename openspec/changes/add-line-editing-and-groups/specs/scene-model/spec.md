## ADDED Requirements

### Requirement: Elements can be held together as a group
An element SHALL belong to at most one group, recorded as the system tag `hai.group` on it, so that a group is saved with the project and undone like any other change. Groups SHALL NOT nest. A copy of a group SHALL be a new group.

#### Scenario: Grouping undoes
- **GIVEN** two elements
- **WHEN** they are grouped and the change is undone
- **THEN** the elements are as they were, with any other tags kept

### Requirement: An imported file is one group
The objects that came in from one file SHALL arrive as one group. A file of a single object SHALL need none.

#### Scenario: Import a building
- **WHEN** a file of several objects is imported
- **THEN** every element made from it has the same group
