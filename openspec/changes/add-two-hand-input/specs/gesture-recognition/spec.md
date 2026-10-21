## MODIFIED Requirements

### Requirement: Two-hand pinch reports distance, midpoint and angle
When both hands pinch and the pinches began within 300 ms of each other, or neither hand has yet made a long pinch or started a drag of its own, the system SHALL emit a two-hand stream (start, updates, end). The stream SHALL report the distance between the pinch points as a fraction of the image width, their midpoint, and the angle in degrees of the line from the left to the right pinch point. It SHALL end and suppress single-hand drags for those hands. When one hand lets go, the other SHALL continue as a fresh drag from its current position once it moves, and SHALL NOT produce a tap or a long pinch. A hand that holds a ring open, or already drags on its own, SHALL keep its gesture; the other hand's pinch SHALL then be its own tap or drag.

#### Scenario: Spreading hands
- **GIVEN** both hands pinch together
- **WHEN** the hands move apart
- **THEN** two-hand updates report increasing distance and no single-hand drag updates are emitted

#### Scenario: One hand pinching still, then the other
- **GIVEN** the right hand pinches and stays still for 400 ms
- **WHEN** the left hand pinches too
- **THEN** a two-hand stream starts

#### Scenario: A ring on one hand, a tap on the other
- **GIVEN** the right hand made a long pinch and still holds it
- **WHEN** the left hand pinches and lets go
- **THEN** no two-hand stream starts and the left hand's pinch is a tap

#### Scenario: A drag on one hand, a tap on the other
- **GIVEN** the right hand is dragging
- **WHEN** the left hand pinches and lets go
- **THEN** no two-hand stream starts, the right hand's drag carries on, and the left hand's pinch is a tap

### Requirement: Gesture actions are configurable
A Gestures card SHALL list every gesture with how to make it and what it does, each in a choice of the actions that gesture can take, marking the default. One-hand gestures (pinch tap, long pinch, pinch drag, fist) SHALL have a choice for each hand; two-hand pinch, nod, shake and the stop SHALL have one. By default a long pinch SHALL open the tools ring with the right hand and the create ring with the left; every other gesture SHALL do the same with either hand. Open palm SHALL always engage. The choices SHALL be kept by the bridge in the workspace settings so they survive reloads, browsers and restarts. Settings saved before choices were per hand SHALL apply to both hands. "Reset to defaults" SHALL restore every default. A gesture's row SHALL light up when the camera detects that gesture.

#### Scenario: Choice survives a reload
- **WHEN** the user sets the right hand's pinch tap to select and reloads the page
- **THEN** the right hand's pinch tap is still set to select, a right-hand tap selects what it points at whatever the active tool, and the left hand's tap still uses the tool

#### Scenario: Long pinch opens a ring per hand by default
- **WHEN** the user opens the Gestures card without having changed anything
- **THEN** the long pinch reads "Open the create ring" for the left hand and "Open the tools ring" for the right

#### Scenario: Older settings still apply
- **GIVEN** the workspace settings set pinch tap to select from before choices were per hand
- **WHEN** the app loads
- **THEN** pinch tap is set to select for both hands

#### Scenario: Detected gesture lights its row
- **GIVEN** the system is engaged
- **WHEN** the user taps
- **THEN** the pinch tap row lights up and then goes dark again

## REMOVED Requirements

### Requirement: Two open palms stop
**Reason**: Open palms are also the natural way to show both hands to the camera, so the stop fired by accident.
**Migration**: Replaced by "Two fists, then open hands, stop". The stop event is now `hands.stop`, and stored settings for the old `palms` gesture map to the new `stop` gesture.

## ADDED Requirements

### Requirement: Two fists, then open hands, stop
While engaged, both hands closed into fists together for 250 ms SHALL arm the stop. Both palms opened toward the camera within 1 s of the fists opening SHALL then emit one stop event. Open palms alone SHALL never stop. While both hands are fists, neither hand's fist action SHALL run, until both hands have opened. While the stop is armed, the HUD SHALL say to open both hands.

#### Scenario: Fists then open hands
- **GIVEN** the system is engaged
- **WHEN** both hands are fists for 300 ms and then both palms open toward the camera
- **THEN** exactly one stop event is emitted

#### Scenario: Open palms alone
- **GIVEN** the system is engaged
- **WHEN** both open palms face the camera for 3 s
- **THEN** no stop event is emitted

#### Scenario: Too brief, one hand, or too late
- **WHEN** both hands are fists for only 150 ms before opening, or only one hand is a fist, or the hands rest for more than 1 s between the fists and the palms
- **THEN** no stop event is emitted

#### Scenario: The stop never also cancels the tool
- **GIVEN** Measure is active and the fist is set to cancel
- **WHEN** both hands are fists for a second and then open
- **THEN** Measure stays active

#### Scenario: The HUD prompts while armed
- **WHEN** both hands are fists for 300 ms
- **THEN** the HUD shows "Open both hands to stop" until the hands open
