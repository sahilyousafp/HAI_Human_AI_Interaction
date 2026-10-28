## ADDED Requirements

### Requirement: Each specialist is a face that shows what it is doing
The team strip SHALL show each specialist as a face in the agent's colour with a mark for its role, animated by its state: resting, working, queued or waiting for the user. The agent's name SHALL show under the face while it is busy or selected, and its task and scope SHALL be in its tooltip and available to a screen reader. The animation SHALL stop when the user asks for reduced motion. What the team is doing and Stop all SHALL stay within the rail's width.

#### Scenario: A waiting agent
- **WHEN** an agent waits for the user
- **THEN** its face is startled with a question mark and its name shows under it
