## MODIFIED Requirements

### Requirement: Requests carry resolved references
A request sent by voice SHALL include, alongside the transcript, the captured elements in order (id, type, name), the selection at send time, and the ground point under the hand pointer in millimetres. A request from a held pinch SHALL also include its locked target (an element's id, type and name, or a point in millimetres with the aid that resolved it) and its captured points in order. Every request, typed or spoken, SHALL include the current sketches (label, path or outline, points in millimetres) and the markers (letter, point in millimetres). The agent SHALL receive them as a short context block before the request text, and the agent's user context tool SHALL return the same.

#### Scenario: "Make this 300 thick"
- **GIVEN** the user points at a wall for 500 ms while saying "make this 300 thick"
- **WHEN** the request is sent
- **THEN** the agent receives the transcript together with that wall's id as the first reference

#### Scenario: Held target and points
- **GIVEN** the user holds a pinch on column A, says "copy this there" and rests the hand on a ground point
- **WHEN** the user releases
- **THEN** the agent's context block names column A as the target and lists that ground point as P1 in millimetres

#### Scenario: A sketch reaches the agent
- **GIVEN** an outline S1 is shown
- **WHEN** the user types "a canopy over this" and sends it
- **THEN** the context block lists S1 as an outline with its points in millimetres

#### Scenario: Markers are always included
- **GIVEN** markers A and B exist
- **WHEN** the agent calls its user context tool
- **THEN** the result lists A and B with their points in millimetres
