# Spec Delta

## Purpose
Lets agents read open data about the place a project stands in (portals, buildings, vegetation, weather, ground temperature) without turning the app into something that sends the user's work anywhere: a switch that is off by default, a fixed list of sources, requests that carry a place and never the model, and a visible record of everything contacted.

## ADDED Requirements

### Requirement: Open data is a switch, off by default
The system SHALL have an Open data switch in Settings that is off by default and saved with the workspace. While it is off, no open-data tool SHALL be offered to any agent and the app SHALL make no open-data request. Settings SHALL list, next to the switch, every source that can be contacted, the host it lives on, what it provides and its licence, and each source SHALL have its own switch that is on by default once Open data is on, except a source whose free service is limited to non-commercial use, which SHALL stay off until the user acknowledges that limit.

#### Scenario: Off by default
- **GIVEN** a new workspace
- **WHEN** an agent's tools are listed
- **THEN** none of them fetches open data, and no request to any open-data host is made

#### Scenario: Switched on
- **WHEN** the user switches Open data on
- **THEN** the sources and their hosts and licences are listed, and the open-data tools are offered to the agents whose role includes them

#### Scenario: A non-commercial source waits
- **GIVEN** Open data is on
- **WHEN** a source whose free service is for non-commercial use is listed
- **THEN** it is off, says why, and is used only after the user acknowledges the limit

### Requirement: Requests carry a place and never the work
An open-data request SHALL contain only a place, an area, a time, an identifier of a dataset or a search text. It SHALL NOT contain model geometry, element or project names, file paths, camera images, the user's voice or the conversation. The user's identity SHALL NOT be sent, and every request SHALL carry an identifying User-Agent for the app.

#### Scenario: A buildings request
- **WHEN** an agent asks for the buildings within 300 m of the site
- **THEN** the request sent to the source holds the site's coordinates and the radius and nothing from the project

#### Scenario: Search text is the agent's
- **WHEN** an agent searches a portal for "tree canopy"
- **THEN** only that text and the portal's own paging parameters are sent

### Requirement: Only listed sources and safe hosts are contacted
The system SHALL contact only the hosts of the listed sources and the portal hosts the user has added or the shipped starter list names, over HTTPS. It SHALL refuse an address that resolves to a loopback, private or link-local network, SHALL check every redirect against the same rules, and SHALL limit the time of a request (10 seconds, or up to 60 for a source known to answer slowly), the size of an answer and the kinds of content accepted. A request to any other host SHALL be refused with the reason, and the agent SHALL be told so.

#### Scenario: Private address refused
- **WHEN** an agent asks a portal tool for a URL on 127.0.0.1 or an address on a private network
- **THEN** no request is made and the refusal names the rule

#### Scenario: Redirect to another host
- **GIVEN** a portal answers with a redirect to a host that is not listed
- **WHEN** the request follows redirects
- **THEN** the request stops with a refusal and nothing from the other host is returned

#### Scenario: Oversized answer
- **WHEN** a source answers with more than the size limit
- **THEN** the request stops and the agent is told the answer was too large and how to narrow the request

### Requirement: Every result says where it came from and how old it is
Each result SHALL carry the name of its source, its licence, the attribution the licence asks for, the time the data was observed, the time it was fetched and its age, and SHALL say when a value is inferred, such as a building height estimated from its number of levels. Agents SHALL repeat the source and the age when they report what they found, and the app SHALL show the attributions of the data in use where the user can read them.

#### Scenario: Weather with its age
- **WHEN** an agent asks for the weather now at the site
- **THEN** the result holds the source, licence and attribution, the observation time and the age in minutes

#### Scenario: Estimated height is marked
- **GIVEN** a building has a number of levels but no height in the source
- **WHEN** an agent asks for buildings
- **THEN** that building's height is returned marked as estimated, with the rule used

### Requirement: Results are cached and rate-limited
The system SHALL keep fetched results on disk in the project's workspace and SHALL answer a repeated request from the cache while the entry is within its lifetime, which depends on the kind of data (minutes for weather, days for buildings and rasters). It SHALL limit the rate of requests to each host, and a source that is down or slow SHALL produce a typed error that the agent can report, never a hang.

#### Scenario: Repeated request is answered locally
- **GIVEN** an agent asked for the buildings around the site a minute ago
- **WHEN** it asks again for the same area
- **THEN** the answer comes from the cache with no request to the source and says it is cached

#### Scenario: A source is unavailable
- **WHEN** a source does not answer within the time limit
- **THEN** the tool returns an error naming the source and the cause, and the agent's turn continues

### Requirement: What was contacted is visible
Settings SHALL show a list of the open-data requests made in the session: when, the host, the kind of data, whether it came from the cache and how large it was, and SHALL let the user clear it. Switching Open data off SHALL stop requests at once.

#### Scenario: The record
- **WHEN** an agent has fetched weather and buildings
- **THEN** Settings lists a request for each, with the host and the time

#### Scenario: Switched off mid-turn
- **GIVEN** an agent is waiting for a fetch
- **WHEN** the user switches Open data off
- **THEN** the pending request is cancelled, the agent is told Open data is off, and no further request is made

### Requirement: No account is needed or stored
The listed sources SHALL be usable without an account, an API key or a sign-in, and the app SHALL NOT ask for, store or send such a credential for open data.

#### Scenario: Keyless
- **WHEN** Open data is on in a fresh install
- **THEN** every listed source works without the user entering a key or signing in
