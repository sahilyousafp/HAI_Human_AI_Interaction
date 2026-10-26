# Spec Delta

## MODIFIED Requirements

### Requirement: The team is defined in the project
The system SHALL read the open project's agents from its Claude Code agent definitions (`.claude/agents/*.md`: name, description, tools, model) and HAI's extra details from `.hai/agents.json`, again before every request and task. On the first request in a project it SHALL create the missing default definitions (Mochi, the lead, Architect, Product, Climate, Urban, Simulation, Reviewer, all on Claude Sonnet) without overwriting existing ones, so that a project that already has the earlier five also receives Urban and Simulation, and nothing that the user edited changes. A project's earlier single conversation SHALL become Mochi's.

#### Scenario: Defaults created once
- **GIVEN** a project without agent definitions
- **WHEN** the first request is sent
- **THEN** definitions for mochi, architect, product, climate, urban, simulation and reviewer exist in the project, and mochi's model is Sonnet

#### Scenario: Earlier team gains the new agents
- **GIVEN** a project that has definitions for the earlier five agents
- **WHEN** the team is used again
- **THEN** urban and simulation are added, and the five existing definitions are unchanged

#### Scenario: User edits are kept
- **GIVEN** the project's architect definition was edited by the user
- **WHEN** the bridge restarts and the team is used again
- **THEN** the edited definition is unchanged

#### Scenario: A new specialist is routable
- **WHEN** the user adds an agent definition named "structure" with a description
- **THEN** from Mochi's next request the team includes Structure and Mochi can hand work to it

#### Scenario: Earlier conversation continues with Mochi
- **GIVEN** a project with a conversation from before the team existed
- **WHEN** the first request is sent to the team
- **THEN** Mochi resumes that conversation

### Requirement: Each agent only uses its own tools
Each agent process SHALL reach the app's tool server with its own token, from which the system SHALL know which agent is calling and SHALL offer it only the app tools its definition lists. An agent not marked as changing the model SHALL never be offered the tools that change it, whatever its definition lists. Reviewer, Climate, Urban and Simulation SHALL NOT be able to change the model. Every agent SHALL be offered the panel tools while Generated panels is on, and the panels of an agent that does not change the model SHALL be information only. The open-data tools SHALL be offered only while Open data is on, and only to the agents whose role includes them.

#### Scenario: Reviewer cannot edit
- **WHEN** Reviewer tries to create, update or delete an element
- **THEN** the call is refused, because the app's tool server offers Reviewer no tools that change the model, and the model is unchanged

#### Scenario: Every agent has panels
- **GIVEN** Generated panels is on
- **WHEN** any agent of the team lists its tools
- **THEN** the panel tools are among them

#### Scenario: Open-data tools by role
- **GIVEN** Open data is on
- **WHEN** Mochi, Urban and Reviewer list their tools
- **THEN** Urban has the urban open-data tools, and Mochi and Reviewer have none of them

## ADDED Requirements

### Requirement: Climate reads open real-time climate data
Climate SHALL be able to get the weather now at the site (air temperature, humidity, wind, cloud cover and precipitation), the forecast for the next days by the hour, and the climate normals for the site (monthly temperature, solar radiation and wind), from the open sources of the Open data switch. Each answer SHALL give the source, the time of observation and the age, and Climate SHALL say how old the data is when it reports. When Open data is off, Climate SHALL say so and keep to what it can compute without data, such as the sun's position.

#### Scenario: Weather now
- **GIVEN** Open data is on and the site is set
- **WHEN** Climate asks for the weather now
- **THEN** it receives the values with the source, the observation time and the age in minutes

#### Scenario: Normals for the site
- **WHEN** Climate asks for the climate normals
- **THEN** it receives monthly values for temperature, solar radiation and wind, with the source and the period they cover

#### Scenario: Open data off
- **GIVEN** Open data is off
- **WHEN** the user asks Climate what the weather is
- **THEN** Climate says Open data is off and how to switch it on, and does not state weather it did not read
