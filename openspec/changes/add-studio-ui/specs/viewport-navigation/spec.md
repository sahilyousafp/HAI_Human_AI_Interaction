## MODIFIED Requirements

### Requirement: Hand pointer highlights and selects
Every visible hand's pinch point SHALL drive its own on-screen pointer, amplified by 1.3 around the image centre across the whole window (the toolbar, the model, the camera view and the settings), so the hands reach everything the mouse does. Each pointer SHALL have its hand's colour in the camera overlay (left amber, right the accent), and SHALL be shown whenever its hand is tracked, dimmed while not engaged. The focus hand SHALL drive hover in the model and what "this" and "here" mean in a spoken request; it is the hand that pinched last, else the right hand, else the only hand in view. While engaged and not navigating, the element under the focus hand's pointer SHALL be highlighted only where the model itself is visible, not under anything floating over it. With Select active, a pinch tap from either hand SHALL select the element under that hand's pointer, and a tap on empty space SHALL clear the selection.

#### Scenario: Tap selects the hovered element
- **GIVEN** the pointer is over a wall
- **WHEN** the user performs a pinch tap
- **THEN** that wall becomes the selection and is shown as selected

#### Scenario: Tap on empty space clears
- **GIVEN** a wall is selected
- **WHEN** the user taps with the pointer over empty sky
- **THEN** the selection becomes empty

#### Scenario: Pointer while not engaged
- **GIVEN** the system is not engaged
- **WHEN** both hands are in view
- **THEN** both pointers follow their hands, dimmed, and nothing is highlighted

#### Scenario: Nothing is picked through a panel
- **GIVEN** the camera view floats over part of the model
- **WHEN** a pointer is over the camera view
- **THEN** no element is highlighted there
