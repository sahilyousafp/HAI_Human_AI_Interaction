# Spec Delta

## Purpose

When the user selects objects in a host, HAI shows what they are, and a request about them changes only them unless the user says otherwise, the way a selected area of a document is changed and nothing else.

## ADDED Requirements

### Requirement: The selection card describes the selected components
While objects selected in a host are described, a card SHALL show each one's type and name, layer, largest quantity (in m2 or m3), material and up to three of its properties, for up to 8 objects and how many more. The card SHALL cover no other panel of the HUD.

#### Scenario: A selected canopy
- **GIVEN** a fake Rhino host describes a selected closed polysurface "Canopy" on "Roof::Canopy" with 3.24e10 mm3 and the material "Timber"
- **WHEN** the description arrives
- **THEN** the card shows "Canopy", "Roof::Canopy", "32.4 m3" and "Timber"

### Requirement: A request from the card is limited to the selection
A request sent from the card, or spoken while it is open, SHALL carry the selected components and a limit naming them. The agent SHALL be told to change only those objects.

#### Scenario: Ask about this
- **GIVEN** two Rhino objects are selected and described
- **WHEN** the user types "make these 200 mm thinner" in the card and sends it
- **THEN** the request's context limits it to those two ids in Rhino, and the agent's text has a limit line naming them

### Requirement: Tasks from a limited request are scoped to it
A task the lead hands out for a limited request SHALL have the selected ids as its scope when the lead gives none, and a given scope's ids SHALL be narrowed to them. What a run changes outside the scope SHALL be reported as for any claim.

#### Scenario: The scope follows the limit
- **GIVEN** a request limited to ids a1 and a2
- **WHEN** Mochi hands it to Architect with no scope
- **THEN** the task's scope is the ids a1 and a2

### Requirement: What the request changed is shown
When a limited request's tasks have ended, the objects their runs changed SHALL be highlighted until the next selection.

#### Scenario: The changed objects glow
- **GIVEN** a limited request whose run changed object a1
- **WHEN** its task ends
- **THEN** a1 is highlighted as changed
