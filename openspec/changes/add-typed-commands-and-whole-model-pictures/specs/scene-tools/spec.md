## ADDED Requirements

### Requirement: The agents' pictures show what the user has hidden
Elements the user has hidden with "hide" or "isolate" SHALL NOT be drawn, picked or snapped to in the user's view, and SHALL be drawn in the pictures taken from the agents' own cameras.

#### Scenario: A hidden block in an agent's picture
- **WHEN** the user hides a block and an agent takes a picture from its own camera
- **THEN** the block is in the picture, and the user's view is still without it
