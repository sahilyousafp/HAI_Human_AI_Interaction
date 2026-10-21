# Spec Delta

## ADDED Requirements

### Requirement: Long pinch is reported as a hold
A pinch held for 800 ms while moving less than 4% of the image width SHALL emit one hold event at the pinch position, together with the start of a drag. The pinch SHALL then continue as a drag until release, so the same pinch can be steered after the hold, and SHALL NOT be reported as a tap. A pinch that has moved 4% of the image width SHALL never hold, even if it stops later.

#### Scenario: Hold then steer
- **GIVEN** the system is engaged
- **WHEN** the user pinches, keeps the hand still for 800 ms, then moves and releases
- **THEN** a hold event is emitted once at 800 ms, followed by drag updates and a drag end, and no tap

#### Scenario: Moving pinch never holds
- **WHEN** the user pinches and moves steadily for 1 s
- **THEN** no hold event is emitted

#### Scenario: A pinch that moved and stopped does not hold
- **WHEN** the user pinches, moves the hand more than 4% of the image width, then keeps it still for 1 s
- **THEN** no hold event is emitted
