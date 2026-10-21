# agent-addressing Specification

## Purpose
Lets the user say or type which agent should do something by starting with its name, matched forgivingly because speech recognition mishears names, and optionally lets the user start a request just by saying a name.

## Requirements

### Requirement: A leading name or mention picks the agent
A request, spoken or typed, that starts with an agent's name, or that mentions an agent anywhere as `@name`, SHALL be delivered to Mochi with that agent as the intended specialist. A request naming Mochi, or no agent, SHALL be left to Mochi to route. The name, and a greeting before it, SHALL be removed from the request text Mochi works on.

#### Scenario: Spoken specialist name
- **WHEN** the user says "Architect, add a stair core here"
- **THEN** Mochi receives "add a stair core here" with Architect as the intended specialist, and hands the task to Architect

#### Scenario: Mochi asked to delegate
- **WHEN** the user says "Mochi, ask Climate to run a winter shadow study"
- **THEN** Mochi receives the request and hands the study to Climate

### Requirement: Names are matched forgivingly
Names SHALL be matched on the first one or two words of a request, ignoring case and punctuation, against each agent's name and other names, allowing one character of difference for names of four or more letters. A greeting before the name (hey, hi, hello, ok or okay) SHALL be allowed. Each default agent SHALL have other names for common mishearings (such as "Machi" and "Maci" for Mochi and "Review or" for Reviewer), and the user SHALL be able to add other names in the Agents tab.

#### Scenario: Misheard name
- **WHEN** the transcript reads "Machi: ask climate to run a winter shadow study"
- **THEN** the request is addressed to Mochi

#### Scenario: Split name
- **WHEN** the transcript reads "Review or check the floor heights"
- **THEN** the request is addressed to Reviewer with "check the floor heights"

#### Scenario: Greeting before the name
- **WHEN** the transcript reads "Hey Mochi, status?"
- **THEN** the request is addressed to Mochi with "status?"

#### Scenario: No name
- **WHEN** the transcript reads "add three floors"
- **THEN** the request goes to Mochi without an intended specialist

### Requirement: Listening for names is opt-in and visible
The system SHALL offer a Listen for names setting, off by default and remembered, that keeps the microphone listening and sends only utterances that start with a team name to the usual review. While it is on, the header SHALL show Listening for names. Audio SHALL stay on the laptop, and other utterances SHALL be dropped at once without being shown, sent or stored. Speech heard while Mochi is speaking SHALL NOT become a request. The microphone button and talk key SHALL keep working.

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
