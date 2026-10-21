## MODIFIED Requirements

### Requirement: The user can interrupt and mute
Speaking SHALL stop at once when the user:
- presses the microphone;
- holds the talk key;
- presses a stop control;
- makes the stop gesture (both fists, then open hands).

The user SHALL be able to mute spoken replies with the speaker button beside the microphone or the Speak Mochi's replies setting; the setting SHALL be remembered.

#### Scenario: Talking interrupts
- **GIVEN** Mochi is speaking
- **WHEN** the user presses the microphone
- **THEN** speaking stops before listening starts

#### Scenario: Muted
- **GIVEN** spoken replies are muted
- **WHEN** Mochi replies
- **THEN** the reply appears in the panel and nothing is spoken
