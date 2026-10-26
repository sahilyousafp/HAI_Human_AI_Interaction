# Spec Delta

## Purpose
Gives a project a place on Earth, so that data about a place can be asked for and drawn in the model's own coordinates.

## ADDED Requirements

### Requirement: A project can have a site
A project SHALL be able to hold a site: a latitude and longitude, the angle of true north from the model's +Y axis, and the model point (in millimetres) that stands at that latitude and longitude, which is the model's origin by default. The site SHALL be saved with the project and restored when it is opened, and a project without one SHALL work as before.

#### Scenario: Saved with the project
- **GIVEN** a site is set
- **WHEN** the project is saved and opened again
- **THEN** the site is the same

#### Scenario: No site
- **WHEN** a project without a site is opened
- **THEN** nothing about it changes and no open-data request needing a place is made

### Requirement: The user sets the site, or approves an agent's proposal
The user SHALL be able to enter the site in Settings (coordinates, north angle, anchor point). An agent SHALL be able to propose a site, and the proposal SHALL show an approval card with the values, so that nothing is set without the user's decision. Changing the site SHALL show the saved values in Settings, where Clear removes it, and the context layer built on the old site SHALL be marked out of date.

#### Scenario: Agent proposes a site
- **WHEN** an agent proposes latitude 52.37, longitude 4.90 and north 0 degrees
- **THEN** an approval card shows those values, and the site is set only after the user allows it

#### Scenario: Denied proposal
- **WHEN** the user denies the proposal
- **THEN** the project has no site change and the agent is told

#### Scenario: Out-of-date layer
- **GIVEN** a context layer was built for one site
- **WHEN** the site is changed
- **THEN** the layer is marked out of date and is rebuilt only when an agent asks again

### Requirement: Places become model coordinates, and back
The system SHALL convert between geographic coordinates and model millimetres using the site, with +Y toward true north rotated by the site's north angle, and SHALL return positions from open-data tools in model millimetres. Values SHALL be validated: latitude in -90 to 90, longitude in -180 to 180.

#### Scenario: A point 100 m north
- **GIVEN** a site with north angle 0 degrees at the origin
- **WHEN** a point 100 m north of the site is converted
- **THEN** it lies at about y = 100000 mm and x = 0

#### Scenario: Rotated north
- **GIVEN** the site's north angle is 90 degrees
- **WHEN** a point 100 m north of the site is converted
- **THEN** it lies along the model's x axis, 100000 mm from the origin

#### Scenario: Invalid latitude
- **WHEN** a site with latitude 120 is entered
- **THEN** it is refused with the allowed range and nothing is saved

### Requirement: Tools that need a place say so
An open-data tool that needs a place and finds no site SHALL return a refusal that says the site is not set and how to set it, and SHALL make no request. A tool MAY take a place from the agent's own arguments, which SHALL be validated the same way, so that a request about another place is possible without changing the site.

#### Scenario: No site
- **GIVEN** the project has no site
- **WHEN** an agent asks for the weather now with no coordinates
- **THEN** it is told to set the site, with how, and no request is made

#### Scenario: Another place
- **GIVEN** the project has a site
- **WHEN** an agent asks for the weather now at explicit coordinates elsewhere
- **THEN** the request uses those coordinates and the site is unchanged
