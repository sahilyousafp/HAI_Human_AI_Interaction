## MODIFIED Requirements

### Requirement: Listening starts only on explicit action
Speaking SHALL be the main way to ask the agent. The system SHALL start listening only when the user presses the microphone button in the agent panel, holds the talk key (`` ` ``), holds a pinch bound to hold to talk, or chooses Ask agent in the palette (or presses its A key), or while a listening setting the user turned on keeps the microphone open. Starting to listen SHALL open the agent panel on the chat, except for a held pinch, which shows its transcript beside the hand. The header SHALL show a microphone indicator that reads Mic on while the microphone is live and Mic off otherwise.

#### Scenario: No microphone on load
- **WHEN** the app loads
- **THEN** no microphone permission is requested and the indicator shows the microphone as off

#### Scenario: Listening from the palette
- **WHEN** the user chooses Ask agent from the palette
- **THEN** the agent panel opens, the microphone starts and the indicator shows Mic on

#### Scenario: Listening from a held pinch
- **WHEN** the user makes a pinch hold on the model with the default binding
- **THEN** the microphone starts, the indicator shows Mic on and the agent panel stays as it was

### Requirement: Utterances end on silence
After speech starts, the system SHALL end the utterance after 800 ms of silence, after 20 s in total, or when the user releases the talk key, releases a held pinch or presses the microphone button again, and SHALL stop the microphone as soon as the utterance ends. While a pinch is held, silence SHALL NOT end the utterance. If no speech starts within 8 s, listening SHALL stop without sending anything.

#### Scenario: Silence ends the utterance
- **GIVEN** the user is speaking after pressing the microphone button
- **WHEN** 800 ms of silence follows
- **THEN** the utterance ends and the microphone stops

#### Scenario: A pause during a held pinch
- **GIVEN** the user holds a pinch and has said "copy this"
- **WHEN** the user pauses for 1.5 s, says "there" and releases
- **THEN** one utterance "copy this there" is sent

#### Scenario: Nothing said
- **GIVEN** the microphone is listening
- **WHEN** no speech starts within 8 s
- **THEN** listening stops, the microphone turns off and nothing is sent

### Requirement: Transcript is confirmed before sending
The transcript SHALL appear in the HUD with a countdown. The request SHALL be sent 5 s after the utterance ends unless the user cancels. A nod, Enter or Send SHALL send it immediately; a shake, Escape or Discard SHALL discard it. Clicking the transcript to correct it SHALL stop the countdown until the user presses Enter. While a transcript waits, nod and shake SHALL answer it before any approval card. A transcript from a held pinch SHALL be sent on release without a countdown, and a transcript that is only a tool's spoken name SHALL pick the tool instead of waiting.

#### Scenario: Nod sends immediately
- **GIVEN** an utterance has just ended
- **WHEN** the user nods within 1.5 s
- **THEN** the request is sent at once

#### Scenario: Shake discards
- **GIVEN** an utterance has just ended
- **WHEN** the user shakes their head within 1.5 s
- **THEN** nothing is sent and the transcript is marked discarded

#### Scenario: Correcting the transcript
- **GIVEN** an utterance has just ended
- **WHEN** the user clicks the transcript and changes a word
- **THEN** the countdown stops and the corrected request is sent when the user presses Enter

## ADDED Requirements

### Requirement: A tool's name alone picks the tool
A transcript that, apart from case, punctuation and a leading "use" or "tool", is exactly one registered tool's spoken name SHALL activate that tool (or run it once if it is an instant tool) without a request to the agent, allowing one letter of difference in names of five letters or more. The HUD SHALL name the tool picked. Any other transcript SHALL go to the agent as before.

#### Scenario: Say a tool name
- **GIVEN** Select is active
- **WHEN** the user says "measure"
- **THEN** Measure becomes the active tool within 300 ms of the utterance ending and no request reaches the agent

#### Scenario: Instant tool by voice
- **GIVEN** the last transaction added a wall
- **WHEN** the user says "undo"
- **THEN** the wall is removed, the previous tool stays active and no request reaches the agent

#### Scenario: Near miss within one letter
- **WHEN** the transcript is "sketch aria"
- **THEN** Sketch area becomes the active tool

#### Scenario: A longer request goes to the agent
- **WHEN** the user says "measure the distance between these towers"
- **THEN** the request goes to the agent and the active tool is unchanged
