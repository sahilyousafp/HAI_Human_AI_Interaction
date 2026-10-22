## ADDED Requirements

### Requirement: A fist drag pans the view
While engaged, a fist drag SHALL move the view the way the Fist drag setting of that hand says. Set to pan (the default), the model SHALL follow the hand like a grabbed map: moving the fist to the right moves the model to the right on screen. Pan SHALL use the same gain as the two-hand pan (1.2 view heights per full image width of movement). Set to orbit, it SHALL orbit like a one-hand pinch drag. Releasing while the fist is still moving SHALL be a flick and coast like any other navigation. A fist drag SHALL be ignored while another navigation (the other hand's drag, or a two-hand pinch) is running, and while the other hand holds a ring open. A fist drag SHALL NOT start a tool, press a control or scroll a list.

#### Scenario: Fist drag pans the model with the hand
- **GIVEN** the system is engaged and Fist drag is set to pan
- **WHEN** the user closes a hand and moves it 10% of the image width to the right
- **THEN** the view target moves so the model slides to the right by 0.12 of the view height, and the camera distance and angles do not change

#### Scenario: Flick coasts
- **WHEN** the user releases a fast fist drag while the hand is still moving
- **THEN** the view keeps sliding the same way after the release and then stops by itself

#### Scenario: The other hand keeps its own job
- **GIVEN** the right hand is orbiting with a pinch drag
- **WHEN** the left hand closes and moves
- **THEN** the orbit is unaffected and the fist drag does not move the view

#### Scenario: A tool does not take a fist drag
- **GIVEN** the Wall tool is active
- **WHEN** the user closes a hand and moves it over the ground
- **THEN** the view pans and no wall is started

#### Scenario: Not engaged
- **GIVEN** the system is not engaged
- **WHEN** a hand closes into a fist and moves
- **THEN** the view does not move
