## REMOVED Requirements

### Requirement: Stop is reachable by click and by gesture
**Reason**: The gesture was two open palms, which fired whenever the user showed both hands to the camera.
**Migration**: Replaced by "Stop is reachable by click and by the stop gesture", which uses both fists followed by open hands.

## ADDED Requirements

### Requirement: Stop is reachable by click and by the stop gesture
The panel SHALL offer a stop control while the agent works. Clenching both hands into fists and then opening both palms toward the camera, while engaged, SHALL also stop it. Open palms alone SHALL NOT stop it. A stopped turn SHALL say that its changes so far are kept as one undo step.

#### Scenario: Stop gesture
- **GIVEN** a running turn and the system is engaged
- **WHEN** both hands are fists for 300 ms and then both palms open toward the camera
- **THEN** the turn stops

#### Scenario: Showing both hands does not stop
- **GIVEN** a running turn and the system is engaged
- **WHEN** both open palms face the camera for 3 s
- **THEN** the turn keeps running
