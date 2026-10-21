## MODIFIED Requirements

### Requirement: Hand pointer highlights and selects
Every visible hand's pinch point SHALL drive its own on-screen pointer, amplified by 1.3 around the image centre across the workspace (the model and the sidebar). Each pointer SHALL have its hand's colour in the camera overlay (left amber, right the accent), and SHALL be shown whenever its hand is tracked, dimmed while not engaged. The focus hand SHALL drive hover in the model and what "this" and "here" mean in a spoken request. The focus hand is the hand that pinched last, else the right hand, else the only hand in view. While engaged and not navigating, the element under the focus hand's pointer SHALL be highlighted, except under HUD panels and outside the model. With Select active, a pinch tap from either hand SHALL select the element under that hand's pointer, and a tap on empty space SHALL clear the selection.

#### Scenario: Tap selects the hovered element
- **GIVEN** the pointer is over a wall
- **WHEN** the user performs a pinch tap
- **THEN** that wall becomes the selection and is shown as selected

#### Scenario: Tap on empty space clears
- **GIVEN** a wall is selected
- **WHEN** the user taps with the pointer over empty sky
- **THEN** the selection becomes empty

#### Scenario: Both hands point
- **GIVEN** the system is engaged
- **WHEN** both hands are in view
- **THEN** each has a full pointer in its own colour, and hover follows the right hand until the left hand pinches

#### Scenario: Pointer while not engaged
- **GIVEN** the system is not engaged
- **WHEN** both hands are in view
- **THEN** both pointers follow their hands, dimmed, and nothing is highlighted

## REMOVED Requirements

### Requirement: The left hand gets a second pointer
**Reason**: Both hands are now equal pointers; the left hand is no longer a quieter, grey second pointer.
**Migration**: See "Hand pointer highlights and selects": each hand has its own full pointer, and the focus hand drives hover.
