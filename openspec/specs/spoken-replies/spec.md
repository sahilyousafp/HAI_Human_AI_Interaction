# spoken-replies Specification

## Purpose
Lets Mochi answer out loud in a natural voice generated on the user's laptop, so the user can keep looking at the model while hearing what the team did.

## Requirements

### Requirement: Mochi's replies are spoken
Mochi's replies and its reports on finished work SHALL be spoken aloud, sentence by sentence, starting with the first sentence while the rest of the reply is still arriving. Replies from specialists, tool details and code SHALL NOT be spoken.

#### Scenario: First sentence starts early
- **WHEN** Mochi replies "Architect is on the stair core. Climate is running the winter study."
- **THEN** speaking of the first sentence starts before the reply has finished arriving

### Requirement: Speech is generated on the laptop
Spoken replies SHALL be generated on the user's machine with the Kokoro voice on WebGPU, from model files the app serves itself. Neither the reply text nor the audio SHALL be sent to a speech service. Where the device has no WebGPU, the system SHALL use a voice installed on the computer that works without the network, and the Voice settings SHALL name the voice in use (or say the computer has none). The user SHALL be able to choose between two Kokoro voices.

#### Scenario: No speech service on the network
- **WHEN** a reply is spoken
- **THEN** no network request carries the reply text or audio to a speech service

### Requirement: The user can interrupt and mute
Speaking SHALL stop at once when the user presses the microphone, holds the talk key, presses a stop control or holds up both open palms. The user SHALL be able to mute spoken replies with the speaker button beside the microphone or the Speak Mochi's replies setting; the setting SHALL be remembered.

#### Scenario: Talking interrupts
- **GIVEN** Mochi is speaking
- **WHEN** the user presses the microphone
- **THEN** speaking stops before listening starts

#### Scenario: Muted
- **GIVEN** spoken replies are muted
- **WHEN** Mochi replies
- **THEN** the reply appears in the panel and nothing is spoken
