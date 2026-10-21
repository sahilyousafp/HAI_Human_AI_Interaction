## MODIFIED Requirements

### Requirement: Hands can press on-screen controls
While engaged, either hand SHALL be able to press anything in the window that the mouse would click: buttons (switches included), links, checkboxes and their labels, and controls marked as hand-pressable. This covers the toolbar, the model's panels, the camera view and the settings sheet. Disabled controls, selects and text fields SHALL NOT be pressed by hand. A control SHALL be outlined, in the colour of the hand, while a hand's pointer is over it. A pinch that starts on a control SHALL press it when released, however long it was held, and SHALL NOT act on the scene, grab, orbit or open a ring. Elements under panels SHALL NOT be picked by the hand.

#### Scenario: Cancel by hand
- **GIVEN** the Measure tool is active
- **WHEN** the user points at the HUD's cancel control and taps
- **THEN** Select becomes the active tool

#### Scenario: A longer pinch on a button still presses it
- **GIVEN** a section exists
- **WHEN** the user pinches on the Remove control for longer than a quick tap and releases
- **THEN** the section is removed

#### Scenario: A switch in the settings by hand
- **GIVEN** the settings are open on the Features page
- **WHEN** the left hand points at the Latency readout switch and taps
- **THEN** the switch is outlined in amber while pointed at, turns off after the tap, and the latency readout leaves the status bar

### Requirement: Users choose the palette layout
Settings > Tool rings SHALL switch between the two rings, and SHALL let the user choose, for each of a ring's 8 slots, any registered tool or none. By default the tools ring holds, clockwise from the top, Select, Ask agent, Measure, Section, Move, Add massing, Delete and Undo. By default the create ring holds Wall, Slab, Column, Add massing, Copy, Redo, Undo and Delete. Both layouts SHALL be kept by the bridge in the workspace settings, so they are the same in every browser and after a restart.

#### Scenario: Layout persists
- **GIVEN** the user moves Section to the tools ring's top slot
- **WHEN** the app is reloaded
- **THEN** Section is still in the top slot

#### Scenario: The create ring has its own layout
- **GIVEN** the user empties the create ring's top slot
- **WHEN** the app is reloaded
- **THEN** the create ring's top slot is still empty and the tools ring is unchanged
