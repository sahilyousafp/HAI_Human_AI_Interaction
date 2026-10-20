# Spec Delta

## Purpose

Lets Mochi answer out loud in a natural voice generated on the user's laptop, so the user can keep looking at the model while hearing what the team did.

## ADDED Requirements

### Requirement: Mochi's replies are spoken
Mochi's replies and its reports on finished work SHALL be spoken aloud, starting with the first sentence while the rest of the reply is still arriving. Replies from specialists, tool details and code SHALL NOT be spoken.

#### Scenario: First sentence starts early
- **WHEN** Mochi replies "Architect is on the stair core. Climate is running the winter study."
- **THEN** speaking of the first sentence starts before the reply has finished arriving

### Requirement: Speech is generated on the laptop
Spoken replies SHALL be generated on the user's machine. Neither the reply text nor the audio SHALL be sent to a speech service. Where the device cannot generate the natural voice fast enough, the system SHALL use a voice installed on the computer and say so in the settings.

#### Scenario: No speech service on the network
- **WHEN** a reply is spoken
- **THEN** no network request carries the reply text or audio to a speech service

### Requirement: The user can interrupt and mute
Speaking SHALL stop at once when the user starts a voice request or presses the microphone or stop control. The user SHALL be able to mute spoken replies; the setting SHALL be remembered.

#### Scenario: Talking interrupts
- **GIVEN** Mochi is speaking
- **WHEN** the user presses the microphone
- **THEN** speaking stops before listening starts

#### Scenario: Muted
- **GIVEN** spoken replies are muted
- **WHEN** Mochi replies
- **THEN** the reply appears in the panel and nothing is spoken
