## ADDED Requirements

### Requirement: The agent can move, turn, scale, mirror and copy elements
The agent SHALL have a `transform_elements` tool that puts elements through steps (translate, rotate, scale, mirror) one after another, each acting on what the one before left, turning or scaling about the centre of the elements together unless a point is named. With `copies: N` it SHALL leave the originals and create N copies, copy i being the originals put through the steps i times. The change SHALL be validated as a whole and be one undo step, and an element that cannot take a step (an imported model cannot be mirrored) SHALL make it change nothing.

#### Scenario: Copy along a line
- **WHEN** the agent calls `transform_elements` on a massing with one translate step of 6 m along y and `copies` 3
- **THEN** three copies exist, 6, 12 and 18 m along y from the original, which is unchanged
