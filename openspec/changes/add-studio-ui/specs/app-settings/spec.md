## ADDED Requirements

### Requirement: Settings open as a sheet from the toolbar
The toolbar SHALL have a settings button that slides a settings sheet in from the right edge, over the model. Ctrl+, SHALL open and close it too. Escape or the sheet's close button SHALL close it. While closed, the sheet SHALL be hidden and out of reach of hands and keyboard. Hands SHALL be able to press and scroll everything in the sheet.

#### Scenario: Opening and closing
- **WHEN** the user presses the settings button
- **THEN** the sheet slides in against the right edge
- **AND WHEN** the user presses Escape
- **THEN** the sheet closes

#### Scenario: Opening by hand
- **GIVEN** the system is engaged
- **WHEN** the left hand points at the settings button and taps
- **THEN** the button is outlined while pointed at, and the sheet opens

### Requirement: Settings are organised in pages
The sheet's first page SHALL list the sections: Camera and tracking, Features, Gestures, Tool rings, Voice and Agent permissions. Each SHALL open its own page with a back button. Show my hands SHALL be a switch at the top of the first page. The page last shown SHALL be shown again when the sheet reopens. Every setting that existed before SHALL keep its control and behaviour on its page.

#### Scenario: A section opens its page
- **WHEN** the user opens Features and then presses Back
- **THEN** the Features page shows, and then the first page again

#### Scenario: The camera readouts moved into Settings
- **GIVEN** the camera is running
- **WHEN** the user opens Camera and tracking
- **THEN** the page shows the backend, frame rate and inference time, and the live Gestures and Detection cards

### Requirement: Features can be switched off
Settings > Features SHALL offer an on/off switch for each feature:
- tool rings;
- create tools;
- two-hand navigation;
- scroll by hand;
- press controls by hand;
- nod and shake;
- the stop gesture;
- voice;
- the agent;
- the latency readout.

Every feature SHALL be on until switched off. The choices SHALL be kept by the bridge in the workspace settings, so they are the same in every browser and after a restart. Switching one feature SHALL never change another.

#### Scenario: A choice survives a reload
- **WHEN** the user switches Create tools off and reloads
- **THEN** Create tools is still off and every other feature is on

### Requirement: A switched-off feature leaves the interface
A switched-off feature SHALL leave the interface and ignore its gestures, its keys and its controls; nothing else SHALL change. A tool that belongs to a switched-off feature SHALL not be listed or chosen, and an active one SHALL hand back to Select.

#### Scenario: Create tools off
- **GIVEN** Create tools is switched off
- **WHEN** the user presses W, or makes a long pinch with the left hand
- **THEN** Select stays active, no ring opens, and Wall, Slab, Column and Copy are not offered in the rings

#### Scenario: Tool rings off
- **GIVEN** Tool rings is switched off
- **WHEN** the user makes a long pinch, holds Space or holds the right button
- **THEN** no ring opens

#### Scenario: Voice off
- **WHEN** the user switches voice off
- **THEN** the microphone button and the microphone indicator disappear, and the talk key does nothing

#### Scenario: Agent off
- **WHEN** the user switches the agent off
- **THEN** the agent panel disappears, and it returns when switched back on

#### Scenario: Nod and shake off
- **GIVEN** Nod and shake is switched off and a tool asks a question
- **WHEN** the user nods
- **THEN** nothing is answered
