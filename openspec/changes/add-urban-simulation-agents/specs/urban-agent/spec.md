# Spec Delta

## Purpose
Gives the team a specialist for the place around a project: what open data says about the city, its buildings, its green and its measurable character.

## ADDED Requirements

### Requirement: Urban is a specialist that reads, never changes the model
The default team SHALL include Urban, an agent for urban context with its own colour that is clearly distinct from the other agents' colours in both themes, and with the speech names "urban", "urbanist" and "planner". Urban SHALL be able to read the model, look through its own cameras, offer information panels and use the open-data and context tools. Urban SHALL NOT be able to change the model or adopt items into it, whatever its definition lists.

#### Scenario: Urban exists
- **GIVEN** a project without agent definitions
- **WHEN** the first request is sent
- **THEN** a definition for urban exists in the project, and the team strip shows Urban in its own colour

#### Scenario: Urban cannot edit
- **WHEN** Urban tries to create, update or delete an element
- **THEN** the call is refused, because the app's tool server offers Urban no tools that change the model, and the model is unchanged

#### Scenario: Addressed by name
- **WHEN** the user says "Urbanist, what is around the site?"
- **THEN** the request goes to Urban

### Requirement: Urban searches open-data portals
Urban SHALL be able to list the portals it can reach, search a portal's catalogue for datasets by text, and read a dataset's table or features, within the size limit, from CKAN, Socrata and ArcGIS Hub portals. The portals SHALL be the shipped starter list and the ones the user adds in Settings. A result SHALL give the dataset's title, publisher, licence and update date where the portal provides them.

#### Scenario: Search a catalogue
- **GIVEN** Open data is on and a CKAN portal is listed
- **WHEN** Urban searches it for "street trees"
- **THEN** it receives datasets with title, publisher, licence and date, and the portal is named in each

#### Scenario: Read a dataset
- **WHEN** Urban reads a dataset that is a table of 5000 rows
- **THEN** it receives the columns, the first rows up to the limit and a note that the rest was left out

#### Scenario: Unlisted portal
- **WHEN** Urban asks for a portal that is not listed
- **THEN** the request is refused with how to add the portal in Settings

### Requirement: Urban reads buildings around the site
Urban SHALL be able to fetch the buildings within a radius of the site (1 km at most by default, 2 km as a limit) with their footprints, heights and the source of each height, and put them in the context layer. A radius or an area above the limit SHALL be refused with the limit.

#### Scenario: Neighbouring buildings
- **GIVEN** the site is set and Open data is on
- **WHEN** Urban asks for the buildings within 300 m
- **THEN** the buildings appear in the context layer, and Urban receives their count, the share with a known height and the source

#### Scenario: Too large
- **WHEN** Urban asks for a radius of 5 km
- **THEN** the request is refused with the limit and nothing is fetched

### Requirement: Urban reads vegetation and reports urban metrics
Urban SHALL be able to get the vegetation cover of an area around the site (the share of tree, shrub and grass cover, and a greenness index of the latest cloud-free scene, with its date) and trees where the sources have them, and SHALL be able to compute urban metrics for an area from what the context layer holds: building coverage ratio, mean and maximum building height, green share and tree count. Each metric SHALL state the area it covers and the sources and dates it rests on.

#### Scenario: Green share
- **WHEN** Urban asks for the vegetation cover within 200 m of the site
- **THEN** it receives the share of each cover class, the source and the date of the data

#### Scenario: Metrics with their basis
- **GIVEN** the layer holds the buildings within 300 m
- **WHEN** Urban asks for the metrics of that area
- **THEN** it receives the building coverage ratio, the mean and maximum height, the green share and the tree count, each with the source and date

#### Scenario: No data for a metric
- **GIVEN** the layer holds no vegetation for the area
- **WHEN** Urban asks for the green share
- **THEN** it is told the data is missing and how to fetch it, rather than receiving a guess

### Requirement: Urban reports what it found and how sure it is
Urban's instructions SHALL tell it to give the source, the date and the age of what it reports, to say when a value is inferred or an area is partly covered, to keep to the question, and to show a table or a chart in an information panel when the numbers are easier to see than to read. When Open data is off, Urban SHALL say so and how to switch it on, and SHALL NOT invent the data.

#### Scenario: Open data off
- **GIVEN** Open data is off
- **WHEN** the user asks Urban for the buildings around the site
- **THEN** Urban says Open data is off and how to switch it on, and no request is made

#### Scenario: Reports with sources
- **WHEN** Urban reports the green share
- **THEN** its answer names the source and the date of the data
