## ADDED Requirements

### Requirement: Show my hands draws the hands over the screen
With Show my hands on, the system SHALL draw each tracked hand as a solid white 2.5D shape over the whole window at about 85% opacity, with its pinch point on that hand's pointer and the hand's proportions kept, following it every animation frame. Show my hands SHALL be off until the user turns it on, and the choice SHALL be kept by the bridge in the workspace settings.

#### Scenario: A solid, rounded hand
- **WHEN** a hand is drawn
- **THEN** it has a rounded palm and tapered fingers in one even white with a soft shadow, and a finger nearer the camera is drawn wider

#### Scenario: A hand at its pointer
- **GIVEN** Show my hands is on and a right hand is tracked with its pinch point at the image centre
- **WHEN** the next frame is drawn
- **THEN** a faint white hand (about 10% opaque) is drawn around the middle of the window, and nothing elsewhere

#### Scenario: Off by default and remembered
- **WHEN** the app starts for the first time
- **THEN** Show my hands is off; once switched on, it is still on after a reload

### Requirement: The hand overlay never takes input
The overlay SHALL never receive pointer events. Hand pointers, presses, scrolls and the mouse SHALL reach what is under it exactly as without it, and the hand pointers SHALL be drawn above it.

#### Scenario: Pressing through a drawn hand
- **GIVEN** Show my hands is on and a drawn hand covers a button
- **WHEN** the hand's pointer is on the button and the user taps
- **THEN** the button is pressed

### Requirement: The hand overlay uses landmarks only
The overlay SHALL be drawn from the tracked hand landmarks alone. No camera image SHALL be drawn outside the camera view, and nothing about the overlay SHALL leave the page.

#### Scenario: No image in the overlay
- **WHEN** Show my hands is on while tracking runs
- **THEN** the overlay is drawn from landmark frames, which carry no image data, and no request or bridge message carries image data
