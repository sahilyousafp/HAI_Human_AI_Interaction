# Spec Delta

## ADDED Requirements

### Requirement: User context includes Rhino when it is the active host
When Rhino is the active host, the user context tool SHALL report the Rhino object under the hand pointer, the Rhino selection (object ids with object type and layer), and the active viewport name, so the agent can pass those ids to Rhino tools.

#### Scenario: "This" in Rhino
- **GIVEN** Rhino is the active host and the pointer is over a Brep on layer "Facade"
- **WHEN** the agent reads the user context
- **THEN** it receives that Brep's Rhino object id, its type and the layer "Facade"
