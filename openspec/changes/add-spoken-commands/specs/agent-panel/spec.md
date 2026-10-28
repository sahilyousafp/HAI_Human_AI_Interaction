## ADDED Requirements

### Requirement: Claude chat can be switched off
The Agent feature SHALL be called Claude chat. With it off there SHALL be no chat panel and no agent session, Ask agent SHALL say the chat is switched off, nothing SHALL be sent to Claude, and the model SHALL take the whole width beside the left column.

#### Scenario: The chat is gone
- **WHEN** the user switches Claude chat off in Settings > Features
- **THEN** the chat panel is no longer shown and spoken commands still run
