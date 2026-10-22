## ADDED Requirements

### Requirement: The hand pointer snaps to nearby controls
While engaged and with "Snap to buttons" on (Settings > Features, on by default), a hand pointer within 28 px of a hand-pressable control SHALL snap to the nearest such control: the pointer is drawn locked on the control, the control is outlined, and a pinch SHALL press that control. The snap SHALL hold until the real hand is more than 44 px from the control, and a pinch that started while snapped SHALL keep that control until it is released, however far the hand drifts. Each hand SHALL snap on its own. The snap SHALL NOT start while a tool or the view is being dragged, while a ring is open, or on a control that is disabled or hidden, and the mouse SHALL NOT be snapped. With the switch off, pointers SHALL behave exactly as before.

#### Scenario: A near miss presses the button
- **GIVEN** the system is engaged and the Undo control is on screen
- **WHEN** the hand pointer is 20 px from Undo and the user taps
- **THEN** the pointer was drawn on Undo, and Undo is pressed

#### Scenario: The nearest control wins
- **GIVEN** two controls 40 px apart
- **WHEN** the pointer is 10 px from the first and 30 px from the second
- **THEN** the first is snapped

#### Scenario: A pinch keeps its control
- **GIVEN** the pointer is snapped to a control
- **WHEN** the user pinches and the hand drifts 60 px away before the pinch is released
- **THEN** the control is pressed on release

#### Scenario: Letting go needs a bigger distance
- **GIVEN** the pointer is snapped to a control
- **WHEN** the hand moves 35 px away
- **THEN** the pointer is still snapped
- **AND WHEN** the hand moves 50 px away
- **THEN** the pointer is free again

#### Scenario: Not while dragging on the model
- **GIVEN** the user is orbiting the view by pinch-drag
- **WHEN** the pointer passes within 10 px of a control
- **THEN** it does not snap, and the orbit continues

#### Scenario: Switched off
- **GIVEN** Snap to buttons is off
- **WHEN** the pointer is 20 px from a control and the user taps
- **THEN** nothing is pressed

#### Scenario: Each hand on its own
- **GIVEN** the left hand is snapped to Undo
- **WHEN** the right hand moves over the model
- **THEN** the right hand's pointer is free and the left hand stays snapped
