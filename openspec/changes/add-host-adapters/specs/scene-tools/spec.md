# Spec Delta

## REMOVED Requirements

### Requirement: User context includes Rhino when it is connected
**Reason**: The user context now covers every connected host.
**Migration**: See "User context includes the connected hosts" below.

## ADDED Requirements

### Requirement: User context includes the connected hosts
While hosts are connected and switched on, the user context tool SHALL report the host object under the hand pointer in the viewer, with its host, id, type and layer. It SHALL also report each host's selection (object ids with type and layer), so the agent can pass those ids to `host_run` for the right host.

#### Scenario: "This" in Rhino
- **GIVEN** Rhino is connected and the pointer is over a mirrored Brep on layer "Facade"
- **WHEN** the agent reads the user context
- **THEN** it receives host `rhino`, that Brep's object id, its type and the layer "Facade"

#### Scenario: Two hosts' selections
- **GIVEN** a fake Rhino host has one object selected and a fake Blender host has two
- **WHEN** the agent reads the user context
- **THEN** it receives Rhino's one id and Blender's two ids, each under its host
