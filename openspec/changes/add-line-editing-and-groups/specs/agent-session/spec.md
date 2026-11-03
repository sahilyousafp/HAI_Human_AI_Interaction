## ADDED Requirements

### Requirement: A request about several elements names one group
A request, typed or spoken, about two or more elements that are not one group SHALL first make them one group, as one undo step. Its context SHALL name the group's id, how many elements it has and its middle, and SHALL stay within the limits on references and selection however large the group is.

#### Scenario: A selection goes to the agent
- **GIVEN** three elements selected, not grouped
- **WHEN** the user sends a request
- **THEN** they are one group, the agent's context names it, and one Undo takes the group apart again
