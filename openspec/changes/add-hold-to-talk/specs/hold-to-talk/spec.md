## Purpose

Lets the user point with a held pinch and say what to do in the same gesture, so a request carries exactly the element, point or path the hand picked out, and falls back to the tool ring when nothing is said.

## ADDED Requirements

### Requirement: A long pinch starts hold to talk
While engaged and with the default bindings, a pinch hold with the non-dominant hand SHALL start hold to talk, and a pinch hold with the dominant hand SHALL open the action ring at once without listening. Hold to talk: a progress ring SHALL fill around the hand's pointer during the hold, and when the hold fires the target under the pinch SHALL be locked, the microphone SHALL start and a transcript chip SHALL show beside that hand in the hand's colour. A pinch hold on an on-screen control, or while the active tool holds something, SHALL keep doing that instead.

#### Scenario: Hold on a wall
- **GIVEN** the system is engaged, the right hand is the dominant hand and a wall is under the left hand's pointer
- **WHEN** the left hand makes a pinch hold
- **THEN** the wall is outlined as the locked target, the microphone indicator shows Mic on and a transcript chip appears beside the left hand

#### Scenario: The dominant hand opens its ring
- **GIVEN** the system is engaged and the right hand is the dominant hand
- **WHEN** the right hand makes a pinch hold
- **THEN** the action ring shows at once, the microphone stays off and the hand pointer shows no microphone

#### Scenario: Hold on a control presses it
- **GIVEN** the pointer is on the Undo button
- **WHEN** the user makes a pinch hold and releases
- **THEN** Undo is pressed and the microphone stays off

### Requirement: The locked target is an element, a point or the ground
The locked target SHALL be the element under the pinch when there is one; otherwise the point the drawing aids resolve there (an end, a middle or a centre, at any height); otherwise the ground point under the pinch, in millimetres. The target SHALL stay locked until the hold ends, wherever the hand moves.

#### Scenario: Hold on empty ground
- **GIVEN** nothing is under the pointer and no snap is in reach
- **WHEN** the user makes a pinch hold
- **THEN** the locked target is the ground point under the pinch, shown with a point marker

#### Scenario: Hold near a wall end
- **GIVEN** Endpoint is on and a wall end is within snap reach of the pointer but no element is under it
- **WHEN** the user makes a pinch hold
- **THEN** the locked target is the wall end point and the marker names Endpoint

### Requirement: Listening lasts only while the pinch is held
The microphone SHALL listen only while the pinch is held. Releasing SHALL end the utterance at once and stop the microphone. Opening the hand without having spoken, or disengaging, SHALL stop the microphone and send nothing.

#### Scenario: Release ends listening
- **GIVEN** the user is holding a pinch and speaking
- **WHEN** the user releases the pinch
- **THEN** the microphone stops within 100 ms and the indicator shows Mic off

#### Scenario: Silent hold sends nothing
- **GIVEN** the user holds a pinch without speaking
- **WHEN** the user releases inside the ring's centre
- **THEN** nothing is sent, the microphone is off and the active tool is unchanged

### Requirement: The hand points while speaking
While holding and speaking, every element the hand's pointer rests on for at least 300 ms SHALL be captured as a reference, and every point it rests on for at least 300 ms away from an element SHALL be captured as a point (snapped through the drawing aids), each once and in order. Captured points SHALL show markers P1, P2 and so on until the request is sent or discarded.

#### Scenario: Copy this there
- **GIVEN** the user holds a pinch on column A and starts saying "copy this there"
- **WHEN** the hand moves to an empty spot of ground and rests there for 400 ms, then the user releases
- **THEN** the request's target is column A and its points hold that ground point, shown as P1 before sending

#### Scenario: Passing over is not captured
- **WHEN** the hand crosses a slab for 100 ms while the user is speaking
- **THEN** that slab is not captured

### Requirement: Releasing sends the request without a countdown
Releasing a held pinch after speech SHALL send the transcript at once, without the review countdown, through the usual agent addressing. For 1.5 s after sending, the chip SHALL read "Sent - shake to stop", and a head shake in that time SHALL stop that request ahead of any other question waiting for a shake.

#### Scenario: Held request is sent on release
- **GIVEN** the user holds a pinch on a wall and says "make this 300 thick"
- **WHEN** the user releases
- **THEN** the request is sent within 100 ms of the final transcript, with the wall as target, and no countdown is shown

#### Scenario: Shake stops a sent request
- **GIVEN** a held request was sent 1 s ago
- **WHEN** the user shakes their head
- **THEN** the turn that request started is stopped and nothing it had not yet changed is changed

#### Scenario: Addressing still works
- **WHEN** the user holds a pinch, says "Architect, add a stair core here" and releases
- **THEN** the task goes to Architect with the locked target and the text "add a stair core here"

### Requirement: Silence shows the ring and a flick chooses
When no speech has started 600 ms after the hold fired, the ring for that hand SHALL fade in around the hold position. A move past the ring's centre radius before any speech starts SHALL highlight a slot at once, whether or not the ring is shown yet, and releasing SHALL choose it. Once speech starts, the ring SHALL hide and no slot SHALL be chosen by that hold.

#### Scenario: Silent flick picks a tool
- **GIVEN** the right hand is the dominant hand and Copy is in the action ring's right slot
- **WHEN** the right hand makes a pinch hold, moves right within 300 ms without speaking and releases
- **THEN** Copy becomes the active tool and nothing is sent

#### Scenario: Ring fades in after silence
- **WHEN** the user holds a pinch still and silent for 600 ms after the hold
- **THEN** the ring is shown around the hold position

#### Scenario: Speech wins over a flick
- **GIVEN** the user holds a pinch and starts speaking
- **WHEN** the hand moves right past the centre radius and the user releases
- **THEN** no tool is chosen and the transcript is sent with the hand's resting points

### Requirement: The dominant hand decides each hand's ring
A Dominant hand setting (Right by default), kept by the bridge in the workspace settings, SHALL decide each hand's role: the dominant hand's hold opens the action ring, and the other hand's hold talks and falls back to the reference ring. A hold binding the user never changed SHALL follow its role when the setting changes; one the user chose SHALL stay with its hand.

#### Scenario: Left-handed user
- **GIVEN** Dominant hand is set to Left
- **WHEN** the left hand makes a silent pinch hold
- **THEN** the action ring is shown around the left hand

#### Scenario: Setting persists
- **GIVEN** the user sets Dominant hand to Left
- **WHEN** the app is reloaded
- **THEN** Dominant hand is still Left

### Requirement: Hold use is counted locally
The HUD's Detection card SHALL count, since the camera started, holds, holds with speech, silent flicks per ring and cancelled holds. The counts SHALL stay on this computer and SHALL NOT be sent anywhere.

#### Scenario: Counts update
- **GIVEN** the Detection card shows zero holds
- **WHEN** the user makes one hold with speech and one silent flick on the reference ring
- **THEN** the card shows 2 holds, 1 with speech and 1 reference ring flick

#### Scenario: Counts stay local
- **WHEN** holds are counted during a session
- **THEN** no network request leaves the machine carrying them
