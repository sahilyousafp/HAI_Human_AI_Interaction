# Spec Delta

## Purpose

Lets the user pick design tools directly with their hands through a radial palette, without involving the agent, and lets the palette grow with new tools.

## ADDED Requirements

### Requirement: Long pinch opens the palette at the hand
While engaged, a pinch hold (by default) SHALL open a radial palette of 8 slots centred on the pinch position, ending any orbit that hand was making, and SHALL suspend view navigation while it is open. A pinch hold while the active tool holds something (an element being moved, the section plane), or on an on-screen button, SHALL keep doing that and SHALL NOT open the palette. Disengaging SHALL close the palette without a change.

#### Scenario: Palette opens
- **GIVEN** the system is engaged and no palette is open
- **WHEN** a pinch hold event occurs
- **THEN** the palette appears centred on the pinch position and orbiting stops

#### Scenario: Holding a grabbed object keeps holding it
- **GIVEN** the Section tool is active and the user has pinched the section plane
- **WHEN** the user keeps the hand still for longer than the hold time, then drags down
- **THEN** no palette opens and the section is lowered

### Requirement: Direction and release choose a tool
While the palette is open, the tool in the direction of the pointer from the centre SHALL be highlighted once the pointer is more than 4% of the width of the space the palette was opened in (the camera image for a hand, the view for the mouse) from the centre. Releasing SHALL activate the highlighted tool, or run it once if it is an instant tool. Releasing inside that radius, or over an empty slot, SHALL close the palette without a change.

#### Scenario: Flick right to choose
- **GIVEN** the palette is open with Measure in the right-hand slot
- **WHEN** the user moves the pinched hand to the right and releases
- **THEN** Measure becomes the active tool and the palette closes

#### Scenario: Release in the centre cancels
- **WHEN** the user releases without leaving the centre radius
- **THEN** the palette closes and the active tool is unchanged

### Requirement: Active tool is visible and resettable
The viewer's status bar SHALL always show the active tool with its shortcut and, for any tool but Select, a cancel control that returns to Select. Holding a closed fist for 600 ms, a head shake, or Escape (with the default gesture actions) SHALL return to Select from any tool; a head shake, Escape or the cancel control SHALL first close an open palette, decline a pending confirmation, or drop a drag in progress.

#### Scenario: Fist returns to Select
- **GIVEN** the Move tool is active
- **WHEN** the user holds a fist for 600 ms
- **THEN** Select becomes the active tool and the HUD shows Select

#### Scenario: Short fist does not reset
- **GIVEN** the Move tool is active
- **WHEN** the user closes a fist for 250 ms and opens it again
- **THEN** Move is still active

#### Scenario: Shake returns to Select
- **GIVEN** the Move tool is active and nothing is pending
- **WHEN** the user shakes their head
- **THEN** Select becomes the active tool

### Requirement: The hand pointer shows what a pinch would do
The hand pointer SHALL show what a pinch would do at its position: a plain ring with Select, a ring with the active tool's icon for other tools (red for Delete), a rounded square with up and down arrows over a grabbable section plane or outline, a small dot over an on-screen button or while the palette is open, and a dashed grey ring while not engaged. The pointer SHALL remain visible through tracking dropouts shorter than 250 ms and SHALL disappear after longer ones.

#### Scenario: Pointer shows the tool
- **GIVEN** the system is engaged and Delete is active
- **WHEN** the pointer is over the model
- **THEN** the pointer is a red ring with the Delete icon

#### Scenario: Pointer survives a short dropout
- **GIVEN** the pointer is visible
- **WHEN** tracking loses the hand for 100 ms
- **THEN** the pointer stays visible, and it disappears once the hand has been gone for more than 250 ms

### Requirement: Hands can press on-screen controls
While engaged, a button over the view that is marked as hand-pressable (such as Undo, Redo, the tool cancel control, Remove section, Delete and Keep, Undo again and Redo after an undo) SHALL be outlined when the hand pointer is over it. A pinch that starts on such a button SHALL press it when released there, however long it was held, and SHALL NOT act on the scene, grab, orbit or open the palette. Elements under HUD panels SHALL NOT be picked by the hand.

#### Scenario: Cancel by hand
- **GIVEN** the Measure tool is active
- **WHEN** the user points at the HUD's cancel control and taps
- **THEN** Select becomes the active tool

#### Scenario: A longer pinch on a button still presses it
- **GIVEN** a section exists
- **WHEN** the user pinches on the Remove control for longer than a quick tap and releases
- **THEN** the section is removed

### Requirement: Palette is reachable without hands
Holding Space SHALL open the palette at the mouse pointer and releasing Space SHALL choose. Holding the right mouse button for 400 ms without moving SHALL open the palette at the pointer and releasing it SHALL choose, while a right-button drag started sooner SHALL still pan the view. Every built-in tool SHALL have a single-key shortcut: Select V, Ask agent A, Measure D, Section S, Move M, Add massing B, Delete X, Undo U and Redo R. Keys SHALL be ignored while typing in a text field.

#### Scenario: Keyboard opens the palette
- **WHEN** the user holds Space
- **THEN** the palette opens at the pointer and choosing works by pointer direction and release

#### Scenario: Right button hold opens the palette
- **WHEN** the user holds the right mouse button still over the view
- **THEN** the palette opens at the pointer, and a quick right-button drag afterwards pans the view without opening it

#### Scenario: Shortcut chooses a tool
- **WHEN** the user presses S
- **THEN** Section becomes the active tool

### Requirement: Tools come from a registry
Tools SHALL be provided through a registry. Each tool declares an id, a label, an icon and a single-key shortcut, and may be an instant tool that runs once and leaves the current tool active. New tools registered at runtime SHALL become available for palette slots and by their shortcut without changes to the palette.

#### Scenario: Registered tool appears in settings
- **WHEN** a new tool is registered at runtime
- **THEN** it is listed as available in palette settings

### Requirement: Users choose the palette layout
The Tool palette card SHALL let the user choose, for each of the 8 slots, any registered tool or none. By default the slots hold, clockwise from the top, Select, Ask agent, Measure, Section, Move, Add massing, Delete and Undo. The layout SHALL be kept by the bridge in the workspace settings, so it is the same in every browser and after a restart.

#### Scenario: Layout persists
- **GIVEN** the user moves Section to the top slot
- **WHEN** the app is reloaded
- **THEN** Section is still in the top slot
