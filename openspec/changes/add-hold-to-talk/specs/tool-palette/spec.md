## MODIFIED Requirements

### Requirement: Long pinch opens the palette at the hand
While engaged, a pinch hold SHALL do what that hand's hold binding sets. By default the dominant hand's hold opens the action ring at once, and the other hand's hold starts hold to talk and shows the reference ring when it stays silent; each hand's binding can be changed. The ring SHALL have 8 slots centred on the pinch position, and opening it SHALL end any orbit that hand was making. While a ring is open, the hand that opened it SHALL steer it, and the other hand SHALL keep tapping, pressing, scrolling and navigating. One ring SHALL be open at a time. A pinch hold while the active tool holds something (an element being moved, the section plane, a wall being drawn, a sketch being drawn), or on an on-screen control, SHALL keep doing that and SHALL NOT open a ring or listen. Disengaging SHALL close the ring without a change.

#### Scenario: Palette opens
- **GIVEN** the system is engaged, no ring is open and the right hand is the dominant hand
- **WHEN** the right hand makes a pinch hold and stays silent
- **THEN** the action ring appears centred on the pinch position and orbiting stops

#### Scenario: The left hand opens the reference ring
- **GIVEN** the system is engaged, no ring is open and the right hand is the dominant hand
- **WHEN** the left hand makes a silent pinch hold, moves up and lets go
- **THEN** the reference ring opens in the left hand's colour and Sketch line, in its top slot, becomes the active tool

#### Scenario: A binding opens a ring at once
- **GIVEN** the right hand's hold is bound to the action ring
- **WHEN** the right hand makes a pinch hold
- **THEN** the action ring opens at once and the microphone stays off

#### Scenario: The other hand keeps working
- **GIVEN** the left hand holds the reference ring open
- **WHEN** the right hand taps a block with Select active
- **THEN** the block is selected and the ring stays open

#### Scenario: Holding a grabbed object keeps holding it
- **GIVEN** the Section tool is active and the user has pinched the section plane
- **WHEN** the user keeps the hand still for longer than the hold time, then drags down
- **THEN** no ring opens, the microphone stays off and the section is lowered

### Requirement: Palette is reachable without hands
Holding Space SHALL open the action ring at the mouse pointer, and holding Shift+Space SHALL open the reference ring there; releasing Space SHALL choose. Holding the right mouse button for 400 ms without moving SHALL open the action ring at the pointer (the reference ring with Shift held), and releasing it SHALL choose. A right-button drag started sooner SHALL still pan the view. Every built-in tool SHALL have a single-key shortcut: Select V, Ask agent A, Measure D, Section S, Move M, Add massing B, Delete X, Undo U, Redo R, Wall W, Slab F, Column C, Copy P, Sketch line L, Sketch area E and Place marker K. Keys SHALL be ignored while typing in a text field.

#### Scenario: Keyboard opens the palette
- **WHEN** the user holds Space
- **THEN** the action ring opens at the pointer and choosing works by pointer direction and release

#### Scenario: Keyboard opens the reference ring
- **WHEN** the user holds Shift+Space
- **THEN** the reference ring opens at the pointer

#### Scenario: Right button hold opens the palette
- **WHEN** the user holds the right mouse button still over the view
- **THEN** the action ring opens at the pointer, and a quick right-button drag afterwards pans the view without opening it

#### Scenario: Shortcut chooses a tool
- **WHEN** the user presses E
- **THEN** Sketch area becomes the active tool

### Requirement: Users choose the palette layout
Settings > Tool rings SHALL switch between the action ring and the reference ring, and SHALL let the user choose, for each of a ring's 8 slots, any registered tool or none. By default the action ring holds, clockwise from the top, Select, Move, Copy, Delete, Undo, Column, Wall and Slab. By default the reference ring holds Sketch line, Sketch area, Place marker, Measure, Add massing, Section and two empty slots. Both layouts SHALL be kept by the bridge in the workspace settings, so they are the same in every browser and after a restart.

#### Scenario: Layout persists
- **GIVEN** the user moves Section to the action ring's top slot
- **WHEN** the app is reloaded
- **THEN** Section is still in the top slot

#### Scenario: The reference ring has its own layout
- **GIVEN** the user empties the reference ring's top slot
- **WHEN** the app is reloaded
- **THEN** the reference ring's top slot is still empty and the action ring is unchanged

### Requirement: Tools come from a registry
Tools SHALL be provided through a registry. Each tool declares an id, a label, an icon, a single-key shortcut and one or more spoken names (the first is shown in the ring), and may be an instant tool that runs once and leaves the current tool active. New tools registered at runtime SHALL become available for palette slots, by their shortcut and by their spoken names without changes to the palette or to voice input.

#### Scenario: Registered tool appears in settings
- **WHEN** a new tool is registered at runtime
- **THEN** it is listed as available in palette settings

#### Scenario: Registered tool can be spoken
- **GIVEN** a tool with the spoken name "bake" is registered at runtime
- **WHEN** the user says "bake"
- **THEN** that tool becomes the active tool without a request to the agent

## ADDED Requirements

### Requirement: Ring slots show their spoken names
Each ring slot SHALL show the tool's icon and its first spoken name, so the ring also shows what can be said to pick the tool.

#### Scenario: Spoken name under the icon
- **GIVEN** the reference ring is open
- **WHEN** the user looks at its top right slot
- **THEN** the slot shows the Sketch area icon and the word "area"

### Requirement: Old default layouts and bindings move to the new defaults
When the workspace settings hold a ring layout equal to that ring's previous default, or hold bindings equal to the previous default hold bindings (the tools ring for the right hand and the create ring for the left), loading them SHALL replace them with the new defaults. Any other layout or binding SHALL be kept as it is, with the tools ring read as the action ring and the create ring as the reference ring.

#### Scenario: Old default layout is replaced
- **GIVEN** the workspace settings hold the previous default tools ring
- **WHEN** the app loads
- **THEN** the action ring holds the new default layout

#### Scenario: Custom layout is kept
- **GIVEN** the user had put Section in the create ring's top slot
- **WHEN** the app loads
- **THEN** the reference ring's top slot still holds Section and the other slots are unchanged
