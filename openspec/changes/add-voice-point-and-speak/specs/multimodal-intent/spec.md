# Spec Delta

## Purpose

Binds spoken references such as "this", "these" and "here" to what the user pointed at, tapped or selected while speaking, so the agent acts on exactly the intended elements.

## ADDED Requirements

### Requirement: Pointing during an utterance is captured
From the moment speech starts until the utterance ends, the system SHALL record each element the hand pointer rests on for at least 300 ms, each element tapped, and the ground point under the pointer when the utterance ends, in order.

#### Scenario: Point at two columns while speaking
- **GIVEN** the user is speaking
- **WHEN** the pointer rests on column A, then on column B, each for 400 ms
- **THEN** the captured references are column A then column B, in that order

#### Scenario: Brief pass-over is ignored
- **WHEN** the pointer crosses a wall for 100 ms during an utterance
- **THEN** that wall is not captured

### Requirement: Captured references are visible before sending
Each captured element SHALL show a numbered marker in the viewer from the moment it is captured until the request is sent or discarded.

#### Scenario: Markers shown
- **GIVEN** two elements were captured during an utterance
- **WHEN** the transcript is waiting to be sent
- **THEN** both elements show markers numbered 1 and 2

### Requirement: Requests carry resolved references
A request sent by voice SHALL include, alongside the transcript, the captured elements in order (id, type, name), the selection at send time, and the final ground point in millimetres.

#### Scenario: "Make this 300 thick"
- **GIVEN** the user points at a wall for 500 ms while saying "make this 300 thick"
- **WHEN** the request is sent
- **THEN** the agent receives the transcript together with that wall's id as the first reference

### Requirement: References fall back to the selection
When nothing was captured during an utterance, the request SHALL carry the current selection as the references.

#### Scenario: Select first, then speak
- **GIVEN** three slabs are selected and the user does not point while speaking
- **WHEN** the request is sent
- **THEN** the references are the three selected slabs
