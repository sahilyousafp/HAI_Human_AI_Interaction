## MODIFIED Requirements

### Requirement: Active tool is visible and resettable
The viewer's status bar SHALL always show the active tool with its shortcut and, for any tool but Select, a cancel control that returns to Select. Holding a closed fist still for 1.5 s, a head shake, or Escape (with the default gesture actions) SHALL return to Select from any tool; a head shake, Escape or the cancel control SHALL first close an open palette, decline a pending confirmation, or drop a drag in progress. A fist that moves far enough to be a fist drag SHALL never return to Select.

#### Scenario: Fist returns to Select
- **GIVEN** the Move tool is active
- **WHEN** the user holds a fist still for 1.5 s
- **THEN** Select becomes the active tool and the HUD shows Select

#### Scenario: Short fist does not reset
- **GIVEN** the Move tool is active
- **WHEN** the user closes a fist for 600 ms and opens it again
- **THEN** Move is still active

#### Scenario: A panning fist does not reset
- **GIVEN** the Move tool is active
- **WHEN** the user closes a fist, drags it across the view for 2 s, and opens it
- **THEN** Move is still active and the view has panned

#### Scenario: Shake returns to Select
- **GIVEN** the Move tool is active and nothing is pending
- **WHEN** the user shakes their head
- **THEN** Select becomes the active tool

## ADDED Requirements

### Requirement: The hand pointer shows pan
While a hand is a fist and its Fist drag is set to pan, its pointer SHALL show a pan icon (four arrows) in place of its ring icon, and SHALL fill in while the view is being moved by that hand's fist drag. A pinch drag that is set to pan SHALL show the same filled pan icon while it moves the view. The pointer SHALL return to its normal look as soon as the hand stops being a fist or the drag ends. While not engaged the pointer SHALL stay dimmed and show no pan icon.

#### Scenario: Fist shows the pan icon
- **GIVEN** the system is engaged and Fist drag is set to pan
- **WHEN** the user closes a hand
- **THEN** that hand's pointer shows the pan icon, unfilled

#### Scenario: Panning fills the icon
- **WHEN** the closed hand moves and the view pans
- **THEN** the pointer's pan icon is filled until the hand opens, and then the pointer returns to the ring of the active tool

#### Scenario: Set to nothing, no pan icon
- **GIVEN** the hand's Fist drag is set to nothing
- **WHEN** the hand closes into a fist
- **THEN** its pointer does not show the pan icon

#### Scenario: Pinch drag set to pan
- **GIVEN** the right hand's Pinch drag is set to pan
- **WHEN** the user pinches and drags
- **THEN** the right pointer shows the filled pan icon while the view moves
