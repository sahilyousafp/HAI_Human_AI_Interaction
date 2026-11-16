# Spec Delta

## REMOVED Requirements

### Requirement: Python tools go to the agents that should have them
**Reason**: The Rhino tools are replaced by the host tools.
**Migration**: See "Host and Python tools go to the agents that should have them" below.

## ADDED Requirements

### Requirement: Host and Python tools go to the agents that should have them
The agents that change the model (Architect, Product) SHALL be able to use `host_run`, `host_place_image` and `python_run`. Every agent SHALL be able to use the read-only host tools (`host_list`, `host_read`, `host_capture`, `host_api`), and Climate SHALL also be able to use `python_run`. The bridge SHALL NOT offer `host_run` or `host_place_image` to an agent not marked as changing the model.

#### Scenario: Roles get their tools
- **GIVEN** Rhino is connected and switched on
- **WHEN** each default agent's session lists its tools
- **THEN** Architect and Product have `host_run`, `host_place_image`, `python_run` and the read-only host tools, Climate has `python_run` and the read-only host tools, and Reviewer has only the read-only host tools

#### Scenario: Reviewer cannot run code in a host
- **WHEN** Reviewer's session calls `host_run`
- **THEN** the bridge refuses the call because the tool is not in its definition

### Requirement: Host tools exist only while a host is switched on
The host tools SHALL be offered only while at least one host is switched on, and their descriptions SHALL name only the hosts in use.

#### Scenario: No host, no host tools
- **GIVEN** every host is switched off
- **WHEN** Architect's session lists its tools
- **THEN** it has `python_run` and no host tool
