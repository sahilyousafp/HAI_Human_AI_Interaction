# Spec Delta

## Purpose

Connects the user's hands, head and agent to Rhino 8, so the same gestures that drive the built-in viewer drive Rhino's viewport and selection, and the agent can model and draft in Rhino. Rhino is the modelling and drafting host; what the agent can compute comes from Python (`python-tools`, `rhino-python`).

## ADDED Requirements

### Requirement: One command connects Rhino to the bridge
Running `HaiConnect` in Rhino SHALL connect the plugin to the running bridge without the user copying any token. If the bridge is not running, the command SHALL say so and how to start it.

#### Scenario: Connect
- **GIVEN** the bridge is running
- **WHEN** the user runs `HaiConnect` in Rhino
- **THEN** Rhino's command line reports "Connected to HAI" and the HUD shows Rhino as connected

#### Scenario: Bridge not running
- **WHEN** the user runs `HaiConnect` and no bridge is running
- **THEN** the command line says the bridge is not running and to start `pnpm dev`

### Requirement: The link survives bridge restarts
While connected, the plugin SHALL reconnect automatically within 5 seconds after the bridge restarts, until the user runs `HaiDisconnect`.

#### Scenario: Bridge restart
- **GIVEN** Rhino is connected
- **WHEN** the bridge restarts
- **THEN** Rhino is connected again within 5 seconds without user action

### Requirement: The user chooses the active host
The HUD SHALL let the user switch the active host between the built-in viewer and Rhino when Rhino is connected. Navigation and pointing SHALL go only to the active host.

#### Scenario: Switch to Rhino
- **GIVEN** Rhino is connected
- **WHEN** the user switches the host to Rhino
- **THEN** hand navigation moves Rhino's active viewport and the built-in viewer camera stays still

### Requirement: Hand navigation drives Rhino's active viewport
When Rhino is the active host, one-hand pinch drag SHALL orbit, two-hand pinch spread SHALL zoom and two-hand midpoint motion SHALL pan Rhino's active viewport around its target, with the same mappings as the built-in viewer.

#### Scenario: Orbit in Rhino
- **GIVEN** Rhino is the active host with a perspective viewport
- **WHEN** a pinch drag to the right arrives
- **THEN** the viewport camera rotates about its target around the world Z axis

### Requirement: Rhino navigation latency is measured
The system SHALL measure the time from the capture of the frame that caused a Rhino camera change to Rhino's redraw of that change, and SHALL show its 90th percentile in the HUD.

#### Scenario: Latency readout
- **WHEN** the user navigates Rhino by hand
- **THEN** the HUD shows a Rhino redraw latency p90 in milliseconds

### Requirement: The hand pointer works inside Rhino
When Rhino is the active host, the pointer SHALL appear as a cursor ring in Rhino's active viewport. The object under it SHALL be highlighted, and a pinch tap SHALL select that object in Rhino (or clear the selection on empty space).

#### Scenario: Tap selects a Rhino object
- **GIVEN** the pointer is over a surface in Rhino
- **WHEN** the user performs a pinch tap
- **THEN** that surface is selected in Rhino

### Requirement: Rhino selection is mirrored
Whenever Rhino's selection changes, by hand, mouse or agent, the bridge SHALL hold the selected object ids within 200 ms.

#### Scenario: Mouse selection mirrored
- **WHEN** the user selects two curves with the mouse in Rhino
- **THEN** the bridge reports those two object ids as the Rhino selection

### Requirement: Rhino Python status is shown
The plugin SHALL report to the bridge whether Python 3 can run in Rhino (`ready` or `unavailable`, with a reason), when it connects and whenever that changes. The HUD SHALL show it beside the Rhino connection, and when it is unavailable SHALL say why and how to fix it.

#### Scenario: Python ready
- **GIVEN** Rhino is connected and its Python 3 engine works
- **WHEN** the user opens the Rhino status
- **THEN** it shows "Python ready"

#### Scenario: Python unavailable
- **GIVEN** Rhino is connected and reports that Python 3 cannot run, with a reason
- **WHEN** the user opens the Rhino status
- **THEN** it shows "Python not available in Rhino" with that reason and how to fix it, and the agent is not offered the Rhino Python tool
