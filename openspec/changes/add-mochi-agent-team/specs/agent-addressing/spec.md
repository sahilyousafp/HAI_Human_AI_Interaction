# Spec Delta

## Purpose

Lets the user say or type which agent should do something by starting with its name, matched forgivingly because speech recognition mishears names, and optionally lets the user start a request just by saying a name.

## ADDED Requirements

### Requirement: A leading name or mention picks the agent
A request that starts with an agent's name, or that mentions an agent as `@name`, SHALL be delivered to Mochi with that agent as the intended specialist. A request naming Mochi, or no agent, SHALL be left to Mochi to route. The name SHALL be removed from the request text Mochi works on.

#### Scenario: Spoken specialist name
- **WHEN** the user says "Architect, add a stair core here"
- **THEN** Mochi receives "add a stair core here" with Architect as the intended specialist, and hands the task to Architect

#### Scenario: Mochi asked to delegate
- **WHEN** the user says "Mochi, ask Climate to run a winter shadow study"
- **THEN** Mochi receives the request and hands the study to Climate

### Requirement: Names are matched forgivingly
Names SHALL be matched on the first one or two words of a request, ignoring case and punctuation, against each agent's name and aliases, allowing one character of difference. Each agent SHALL have default aliases for common mishearings, and the user SHALL be able to add aliases.

#### Scenario: Misheard name
- **WHEN** the transcript reads "Machi: ask climate to run a winter shadow study"
- **THEN** the request is addressed to Mochi

#### Scenario: Split name
- **WHEN** the transcript reads "Review or check the floor heights"
- **THEN** the request is addressed to Reviewer with "check the floor heights"

#### Scenario: No name
- **WHEN** the transcript reads "add three floors"
- **THEN** the request goes to Mochi without an intended specialist

### Requirement: Listening for names is opt-in and visible
The system SHALL offer a setting that keeps the microphone listening and turns only utterances that start with a team name into requests. It SHALL be off by default. While it is on, the header SHALL show that the microphone is listening for names, the audio SHALL stay on the laptop as for any voice request, and utterances that do not start with a name SHALL be discarded without being shown, sent or stored.

#### Scenario: Named utterance becomes a request
- **GIVEN** listening for names is on
- **WHEN** the user says "Mochi, what is everyone doing?"
- **THEN** the request appears with its send countdown, addressed to Mochi

#### Scenario: Other speech is ignored
- **GIVEN** listening for names is on
- **WHEN** the user says "add three floors" without a name
- **THEN** nothing is shown or sent

#### Scenario: Off by default
- **WHEN** the app loads for the first time
- **THEN** listening for names is off and no microphone is requested
