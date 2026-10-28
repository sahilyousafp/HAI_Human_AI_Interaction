## ADDED Requirements

### Requirement: The agent can ask for a named view
`set_view` SHALL accept `view` (top, bottom, front, back, left, right or perspective) and switch the viewer to that view as the view cube does. Framing, a target or a distance given with it SHALL animate from the named view. A named view SHALL be refused together with azimuth or elevation.

#### Scenario: Front, then back
- **WHEN** the agent calls `set_view` with view front, then with view perspective
- **THEN** the viewer is in the Front view, then in perspective

#### Scenario: A direction as well
- **WHEN** the agent gives view top and azimuth 90
- **THEN** the call is refused and the view does not change
