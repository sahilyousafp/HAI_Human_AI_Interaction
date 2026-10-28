## ADDED Requirements

### Requirement: Spoken commands can name a lettered marker
The command grammar SHALL accept "about marker X" or "at marker X" after rotate, scale and mirror, taking the marker as the pivot, and "move to marker X", taking the middle of what is acted on, with its base, to the marker. A marker that has not been placed SHALL give a notice saying so and change nothing. The word "marker" without a single letter after it, or with a verb that takes no marker, SHALL leave the transcript to the agent.

#### Scenario: Rotate about a marker
- **WHEN** a block is selected and the user says "rotate 90 about marker A"
- **THEN** the block is turned a quarter turn counter-clockwise about marker A's position, in one undo step

#### Scenario: A marker that is not there
- **WHEN** the user says "move to marker Q" and no marker Q is placed
- **THEN** the notice says there is no marker Q and nothing moves
