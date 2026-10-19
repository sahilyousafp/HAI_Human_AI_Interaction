# Spec Delta

## ADDED Requirements

### Requirement: Long pinch is reported as a hold
A pinch held for 600 ms while moving less than 2% of the image width SHALL emit one hold event at the pinch position. The pinch SHALL then continue as a drag until release, so the same pinch can be steered after the hold.

#### Scenario: Hold then steer
- **GIVEN** the system is engaged
- **WHEN** the user pinches, keeps the hand still for 600 ms, then moves and releases
- **THEN** a hold event is emitted once at 600 ms, followed by drag updates and a drag end

#### Scenario: Moving pinch never holds
- **WHEN** the user pinches and moves steadily for 1 s
- **THEN** no hold event is emitted
