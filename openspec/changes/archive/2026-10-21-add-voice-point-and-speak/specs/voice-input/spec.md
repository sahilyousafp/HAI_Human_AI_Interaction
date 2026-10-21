# Spec Delta

## Purpose

Lets the user speak requests to their agent, transcribed on their own laptop, with a short window to confirm or cancel before anything is sent.

## ADDED Requirements

### Requirement: Listening starts only on explicit action
Speaking SHALL be the main way to ask the agent. The system SHALL start listening only when the user presses the microphone button in the agent panel, holds the talk key (`` ` ``), or chooses Ask agent in the palette (or presses its A key), or while a listening setting the user turned on keeps the microphone open. Starting to listen SHALL open the agent panel on the chat. The header SHALL show a microphone indicator that reads Mic on while the microphone is live and Mic off otherwise.

#### Scenario: No microphone on load
- **WHEN** the app loads
- **THEN** no microphone permission is requested and the indicator shows the microphone as off

#### Scenario: Listening from the palette
- **WHEN** the user chooses Ask agent from the palette
- **THEN** the agent panel opens, the microphone starts and the indicator shows Mic on

### Requirement: Utterances end on silence
After speech starts, the system SHALL end the utterance after 800 ms of silence, after 20 s in total, or when the user releases the talk key or presses the microphone button again, and SHALL stop the microphone as soon as the utterance ends. If no speech starts within 8 s, listening SHALL stop without sending anything.

#### Scenario: Silence ends the utterance
- **GIVEN** the user is speaking
- **WHEN** 800 ms of silence follows
- **THEN** the utterance ends and the microphone stops

#### Scenario: Nothing said
- **GIVEN** the microphone is listening
- **WHEN** no speech starts within 8 s
- **THEN** listening stops, the microphone turns off and nothing is sent

### Requirement: Speech is transcribed on device by default
By default, audio SHALL be transcribed on the user's machine, with model files the app serves itself. Audio SHALL NOT be uploaded, recorded to disk or kept after its transcript is produced.

#### Scenario: No audio on the network
- **GIVEN** the default speech mode and a recorded speech sample as the fake microphone
- **WHEN** an utterance is transcribed
- **THEN** no network request or bridge message contains audio data

#### Scenario: Transcript of a known sample
- **GIVEN** the fake microphone plays a sample saying "make this wall three hundred thick"
- **WHEN** the utterance is transcribed
- **THEN** the transcript contains the words "make", "wall" and "thick"

### Requirement: Cloud speech is opt-in and labelled
The system SHALL offer the browser's cloud speech service only as an opt-in setting that states audio will be sent to a third party, and SHALL use on-device transcription whenever the setting is off.

#### Scenario: Default is on-device
- **WHEN** the user has never changed the speech setting
- **THEN** transcription runs on device and the setting reads "On this laptop"

### Requirement: Transcript is confirmed before sending
The transcript SHALL appear in the HUD with a countdown. The request SHALL be sent 1.5 s after the utterance ends unless the user cancels. A nod, Enter or Send SHALL send it immediately; a shake, Escape or Discard SHALL discard it. Clicking the transcript to correct it SHALL stop the countdown until the user presses Enter. While a transcript waits, nod and shake SHALL answer it before any approval card.

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

### Requirement: Microphone failures explain the fix
The system SHALL show a specific message with a recovery step when no microphone is found, permission is denied or the microphone cannot start, and typed requests SHALL remain available.

#### Scenario: Microphone denied
- **WHEN** microphone permission is denied
- **THEN** the app says so, explains how to re-enable it, and the typed input stays usable
