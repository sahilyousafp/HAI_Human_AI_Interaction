# Spec Delta

## Purpose

Lets the user pick design tools directly with their hands through a radial palette, without involving the agent, and lets the palette grow with new tools.

## ADDED Requirements

### Requirement: Long pinch opens the palette at the hand
While engaged, a pinch hold SHALL open a radial palette of up to 8 tools centred on the pinch position, and SHALL suspend view navigation while it is open. A pinch hold while the active tool is holding something (an element being moved, the section plane) SHALL keep holding it and SHALL NOT open the palette.

#### Scenario: Palette opens
- **GIVEN** the system is engaged and no palette is open
- **WHEN** a pinch hold event occurs
- **THEN** the palette appears centred on the pinch position and orbiting stops

#### Scenario: Holding a grabbed object keeps holding it
- **GIVEN** the Section tool is active and the user has pinched the section plane
- **WHEN** the user keeps the hand still for longer than the hold time, then drags down
- **THEN** no palette opens and the section is lowered

### Requirement: Direction and release choose a tool
While the palette is open, the tool in the direction of the pinch point from the centre SHALL be highlighted once the pinch point is more than 4% of the image width from the centre. Releasing the pinch SHALL activate the highlighted tool. Releasing inside that radius SHALL close the palette without a change.

#### Scenario: Flick right to choose
- **GIVEN** the palette is open with Measure in the right-hand slot
- **WHEN** the user moves the pinched hand to the right and releases
- **THEN** Measure becomes the active tool and the palette closes

#### Scenario: Release in the centre cancels
- **WHEN** the user releases without leaving the centre radius
- **THEN** the palette closes and the active tool is unchanged

### Requirement: Active tool is visible and resettable
The HUD SHALL always show the active tool and a control that returns to Select. Holding a closed fist for 600 ms, a head shake, or Escape SHALL return to Select from any tool (a head shake or Escape first closes an open palette, declines a pending confirmation, or drops a drag in progress). The hand pointer SHALL show what a pinch would do at its position (the active tool, grabbing, pressing a control), and SHALL remain visible through tracking dropouts shorter than 250 ms.

#### Scenario: Fist returns to Select
- **GIVEN** the Move tool is active
- **WHEN** the user holds a fist for 600 ms
- **THEN** Select becomes the active tool and the HUD shows Select

#### Scenario: Shake returns to Select
- **GIVEN** the Move tool is active and nothing is pending
- **WHEN** the user shakes their head
- **THEN** Select becomes the active tool

### Requirement: Hands can press on-screen controls
A pinch tap over a button in the viewer's HUD SHALL press that button instead of acting on the scene, and the button under the hand pointer SHALL be highlighted while engaged.

#### Scenario: Cancel by hand
- **GIVEN** the Measure tool is active
- **WHEN** the user points at the HUD's cancel control and taps
- **THEN** Select becomes the active tool

### Requirement: Palette is reachable without hands
Holding Space or holding the right mouse button SHALL open the palette at the pointer, and every built-in tool SHALL have a single-key shortcut.

#### Scenario: Keyboard opens the palette
- **WHEN** the user holds Space
- **THEN** the palette opens at the pointer and choosing works by pointer direction and release

### Requirement: Tools come from a registry
Tools SHALL be provided through a registry. Each tool declares an id, a label, an icon and a shortcut. New tools registered at runtime SHALL become available for palette slots without changes to the palette.

#### Scenario: Registered tool appears in settings
- **WHEN** a new tool is registered at runtime
- **THEN** it is listed as available in palette settings

### Requirement: Users choose the palette layout
The user SHALL be able to choose which tools occupy the 8 slots and in which positions. The layout SHALL persist across sessions.

#### Scenario: Layout persists
- **GIVEN** the user moves Section to the top slot
- **WHEN** the app is reloaded
- **THEN** Section is still in the top slot
