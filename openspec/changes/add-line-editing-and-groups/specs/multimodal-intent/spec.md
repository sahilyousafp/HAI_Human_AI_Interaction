## ADDED Requirements

### Requirement: Pointing at part of a selection means all of it
While the user speaks, an element pointed at that is part of the selection SHALL mean the whole selection, and one that is a member of a group SHALL mean the whole group. An element pointed at outside the selection SHALL still mean that element.

#### Scenario: A hand rests on one part
- **GIVEN** three elements selected
- **WHEN** the user says "rotate this" with the hand resting on one of them
- **THEN** all three turn together
