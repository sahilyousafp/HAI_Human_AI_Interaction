## MODIFIED Requirements

### Requirement: Long pinch opens the palette at the hand
While engaged, a pinch hold SHALL open the ring set for that hand (by default the tools ring for the right hand and the create ring for the left). The ring SHALL have 8 slots centred on the pinch position, and opening it SHALL end any orbit that hand was making. While a ring is open, the hand that opened it SHALL steer it, and the other hand SHALL keep tapping, pressing, scrolling and navigating. One ring SHALL be open at a time. A pinch hold while the active tool holds something (an element being moved, the section plane, a wall being drawn), or on an on-screen control, SHALL keep doing that and SHALL NOT open a ring. Disengaging SHALL close the ring without a change.

#### Scenario: Palette opens
- **GIVEN** the system is engaged and no ring is open
- **WHEN** the right hand makes a pinch hold
- **THEN** the tools ring appears centred on the pinch position and orbiting stops

#### Scenario: The left hand opens the create ring
- **GIVEN** the system is engaged and no ring is open
- **WHEN** the left hand makes a pinch hold, moves up and lets go
- **THEN** the create ring opens in the left hand's colour and Wall, in its top slot, becomes the active tool

#### Scenario: The other hand keeps working
- **GIVEN** the left hand holds the create ring open
- **WHEN** the right hand taps a block with Select active
- **THEN** the block is selected and the ring stays open

#### Scenario: Holding a grabbed object keeps holding it
- **GIVEN** the Section tool is active and the user has pinched the section plane
- **WHEN** the user keeps the hand still for longer than the hold time, then drags down
- **THEN** no ring opens and the section is lowered

### Requirement: The hand pointer shows what a pinch would do
Each hand's pointer SHALL show what a pinch with that hand would do at its position:
- a plain ring with Select;
- a ring with the active tool's icon for other tools (red for Delete);
- a rounded square with up and down arrows over a grabbable section plane or outline, for the focus hand;
- a small dot over a control it would press, or while that hand's ring is open;
- a dashed grey ring while not engaged.

A pointer SHALL remain visible through tracking dropouts shorter than 250 ms and SHALL disappear after longer ones.

#### Scenario: Pointer shows the tool
- **GIVEN** the system is engaged and Delete is active
- **WHEN** a pointer is over the model
- **THEN** that pointer is a red ring with the Delete icon

#### Scenario: Pointer survives a short dropout
- **GIVEN** the pointer is visible
- **WHEN** tracking loses the hand for 100 ms
- **THEN** the pointer stays visible, and it disappears once the hand has been gone for more than 250 ms

### Requirement: Hands can press on-screen controls
While engaged, either hand SHALL be able to press, anywhere on the page (over the model and in the sidebar), what the mouse would click: buttons, links, checkboxes and their labels, and controls marked as hand-pressable. Disabled controls, selects and text fields SHALL NOT be pressed by hand. A control SHALL be outlined while a hand's pointer is over it. A pinch that starts on a control SHALL press it when released, however long it was held, and SHALL NOT act on the scene, grab, orbit or open a ring. Elements under HUD panels SHALL NOT be picked by the hand.

#### Scenario: Cancel by hand
- **GIVEN** the Measure tool is active
- **WHEN** the user points at the HUD's cancel control and taps
- **THEN** Select becomes the active tool

#### Scenario: A longer pinch on a button still presses it
- **GIVEN** a section exists
- **WHEN** the user pinches on the Remove control for longer than a quick tap and releases
- **THEN** the section is removed

#### Scenario: The left hand presses a control in the sidebar
- **GIVEN** the system is engaged
- **WHEN** the left hand points at the Create ring tab in the sidebar's Tool palette card and taps
- **THEN** the tab is outlined while pointed at, and is selected after the tap

### Requirement: Palette is reachable without hands
Holding Space SHALL open the tools ring at the mouse pointer, and holding Shift+Space SHALL open the create ring there; releasing Space SHALL choose. Holding the right mouse button for 400 ms without moving SHALL open the tools ring at the pointer (the create ring with Shift held), and releasing it SHALL choose. A right-button drag started sooner SHALL still pan the view. Every built-in tool SHALL have a single-key shortcut: Select V, Ask agent A, Measure D, Section S, Move M, Add massing B, Delete X, Undo U, Redo R, Wall W, Slab F, Column C and Copy P. Keys SHALL be ignored while typing in a text field.

#### Scenario: Keyboard opens the palette
- **WHEN** the user holds Space
- **THEN** the tools ring opens at the pointer and choosing works by pointer direction and release

#### Scenario: Keyboard opens the create ring
- **WHEN** the user holds Shift+Space
- **THEN** the create ring opens at the pointer

#### Scenario: Right button hold opens the palette
- **WHEN** the user holds the right mouse button still over the view
- **THEN** the tools ring opens at the pointer, and a quick right-button drag afterwards pans the view without opening it

#### Scenario: Shortcut chooses a tool
- **WHEN** the user presses W
- **THEN** Wall becomes the active tool

### Requirement: Users choose the palette layout
The Tool palette card SHALL have a tab for each ring, and SHALL let the user choose, for each of a ring's 8 slots, any registered tool or none. By default the tools ring holds, clockwise from the top, Select, Ask agent, Measure, Section, Move, Add massing, Delete and Undo. By default the create ring holds Wall, Slab, Column, Add massing, Copy, Redo, Undo and Delete. Both layouts SHALL be kept by the bridge in the workspace settings, so they are the same in every browser and after a restart.

#### Scenario: Layout persists
- **GIVEN** the user moves Section to the tools ring's top slot
- **WHEN** the app is reloaded
- **THEN** Section is still in the top slot

#### Scenario: The create ring has its own layout
- **GIVEN** the user empties the create ring's top slot
- **WHEN** the app is reloaded
- **THEN** the create ring's top slot is still empty and the tools ring is unchanged

## ADDED Requirements

### Requirement: Hands scroll what scrolls
A pinch-drag with either hand that starts over a scrolled area with more to show (the agent conversation, the extensions, the sidebar) SHALL scroll it, the content following the hand as on a touch screen. Released while moving faster than 0.3 px per ms, the content SHALL coast on and slow to a stop; pinching it SHALL catch it. A pinch-drag that starts on a control inside a scrolled area SHALL press it, unless the hand first moves up or down by 2% of the view's height, which scrolls instead.

#### Scenario: Scrolling the sidebar
- **GIVEN** the system is engaged and the sidebar has more to show
- **WHEN** the right hand pinches on the sidebar away from any control and moves up
- **THEN** the sidebar's content moves up with the hand

#### Scenario: A flick coasts on
- **WHEN** the hand moves quickly and lets go mid-move
- **THEN** the content keeps scrolling in the same direction for a moment and slows to a stop

#### Scenario: A button in a list
- **GIVEN** the agent conversation scrolls
- **WHEN** the user pinches on a tool chip in it and moves the hand down by a tenth of the view's height
- **THEN** the conversation scrolls and the chip is not pressed
