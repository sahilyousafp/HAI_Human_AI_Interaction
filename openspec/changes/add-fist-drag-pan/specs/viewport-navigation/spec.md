## ADDED Requirements

### Requirement: A fist drag pans the view
While engaged, a fist drag SHALL move the view the way the Fist drag setting of that hand says. Set to pan (the default), the view SHALL move with the hand: moving the fist to the right moves the view to the right (the model slides left on screen), and moving it down moves the view down. This is the opposite direction to the two-hand pan and to a pinch drag set to pan, which keep their directions. Pan SHALL use the same gain as the two-hand pan (1.2 view heights per full image width of movement). Set to orbit, it SHALL orbit like a one-hand pinch drag. A fist SHALL hold the view like a grab: while it moves, the drawn view SHALL follow it within a fingertip's width (about 1% of the screen width at 0.45 of the frame a second), and when the fist opens the view SHALL stay where the hand stopped, however fast the hand was moving, with no flick, coasting or spring. A fist drag SHALL be ignored while another navigation (the other hand's drag, or a two-hand pinch) is running, and while the other hand holds a ring open. A fist drag SHALL NOT start a tool, press a control or scroll a list.

#### Scenario: Fist drag carries the view with the hand
- **GIVEN** the system is engaged and Fist drag is set to pan
- **WHEN** the user closes a hand and moves it 10% of the image width to the right
- **THEN** the view moves to the right by 0.12 of the view height (the model slides left on screen), and the camera distance and angles do not change

#### Scenario: A pinch drag set to pan keeps its direction
- **GIVEN** a hand's Pinch drag is set to pan
- **WHEN** the user pinch-drags 10% of the image width to the right
- **THEN** the view moves to the left by 0.12 of the view height, as before this change

#### Scenario: Releasing a moving fist does not coast
- **WHEN** the user sweeps a fist at 0.45 of the frame width a second and opens it while still moving
- **THEN** the view ends where it would have ended had the hand rested first (within 15 px at 1280 px wide), and it does not move on after the release beyond the camera's easing

#### Scenario: The view follows the fist closely
- **WHEN** the user sweeps a fist at 0.45 of the frame width a second
- **THEN** the drawn view is within 12 px (at 1280 px wide) of where the hand has put it when the last movement arrives

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
