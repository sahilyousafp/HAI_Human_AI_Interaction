## ADDED Requirements

### Requirement: A command can be typed when Claude chat is off
With Claude chat off, the bar over the model SHALL have a text box for commands, offered whether or not the voice feature is on. Pressing Enter SHALL take the text as though it had been spoken: a command runs on what is selected or pointed at, delete asks first, and text that is not a command SHALL say so and be sent nowhere.

#### Scenario: Typing a command
- **WHEN** a block is selected, Claude chat is off, and the user types "rotate 90" and presses Enter
- **THEN** the block turns 90 degrees in one undo step and the box is empty again
