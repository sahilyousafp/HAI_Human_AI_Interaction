# Spec Delta

## Purpose

Connects the user's hands, head and agent to Rhino 8, so the agent models in Rhino while the model is drawn in HAI's own viewer, steered by the same gestures as any other model, and picks and selections go both ways. Rhino is the modelling and drafting engine and its window is optional; what the agent can compute comes from Python (`python-tools`, `rhino-python`).

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

### Requirement: Rhino's model is drawn in HAI's viewer
While Rhino is connected and the modelling mode is not Python only, the objects in Rhino's open document SHALL be drawn in the built-in viewer as a read-only layer, in Rhino's layer colours, whoever made them (the agent, a Rhino command or the user with the mouse). Adding, changing, moving, recolouring and deleting an object in Rhino SHALL show in the viewer. Rhino's window MAY be minimised.

#### Scenario: A new object appears
- **GIVEN** Rhino is connected with the viewer open
- **WHEN** the agent's Python adds a lofted surface in Rhino
- **THEN** the surface is drawn in the viewer

#### Scenario: A moved object follows
- **WHEN** the user moves an object with the mouse in Rhino
- **THEN** the viewer draws it at its new place

#### Scenario: A deleted object goes
- **WHEN** an object is deleted in Rhino
- **THEN** it is no longer drawn in the viewer

#### Scenario: Rhino minimised
- **GIVEN** Rhino's window is minimised
- **WHEN** the agent adds an object in Rhino
- **THEN** the object is drawn in the viewer

#### Scenario: Rhino disconnects
- **WHEN** Rhino disconnects
- **THEN** the Rhino layer disappears from the viewer

### Requirement: The Rhino layer is not part of the HAI scene
The Rhino layer SHALL NOT be saved with the HAI project, SHALL NOT be in the undo history and SHALL NOT be changed by the scene tools; Rhino owns its objects.

#### Scenario: The mirror is not the scene
- **GIVEN** Rhino objects are drawn in the viewer
- **WHEN** the user saves the HAI project and then undoes in HAI
- **THEN** the saved scene holds no Rhino object and the undo does not change the Rhino layer

### Requirement: Changes in Rhino reach HAI quickly
A change in Rhino SHALL be drawn in the viewer within 300 ms (90th percentile) for edits of up to 50 objects, and the HUD SHALL show the measured time from the change to the drawn frame as **Rhino to HAI**. The first sync of a large document SHALL arrive progressively, smaller objects first, with the HUD showing how many of how many objects are in.

#### Scenario: Latency readout
- **WHEN** objects are edited in Rhino
- **THEN** the HUD shows a Rhino to HAI p90 in milliseconds

#### Scenario: A large model arrives progressively
- **GIVEN** a document with 5000 objects
- **WHEN** Rhino connects
- **THEN** the viewer starts drawing before all objects have arrived and the HUD shows how many have

### Requirement: What is not drawn is counted
Rhino curves, points and annotations SHALL NOT be drawn in the viewer, and an object too heavy to mirror in full SHALL be drawn as its bounding box. The HUD SHALL count both so that a missing object is explained.

#### Scenario: Curves are counted
- **GIVEN** the document holds 12 curves and 40 surfaces
- **WHEN** it is mirrored
- **THEN** the 40 surfaces are drawn and the HUD says 12 curves are not drawn

### Requirement: Picking in HAI selects in Rhino
A pinch tap, or a mouse click, on a mirrored object in the viewer SHALL select that object in Rhino, and a tap on empty space SHALL clear Rhino's selection. The hand pointer SHALL work in HAI's viewer as for any model.

#### Scenario: Tap selects a Rhino object
- **GIVEN** a Rhino surface is drawn in the viewer
- **WHEN** the user performs a pinch tap on it
- **THEN** that surface is selected in Rhino and highlighted in the viewer

### Requirement: Rhino selection is mirrored
Whenever Rhino's selection changes, by hand, mouse or agent, the bridge SHALL hold the selected object ids within 200 ms, and the viewer SHALL highlight those objects.

#### Scenario: Mouse selection mirrored
- **WHEN** the user selects two curves with the mouse in Rhino
- **THEN** the bridge reports those two object ids as the Rhino selection and the viewer highlights them

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

### Requirement: The user chooses how the agent models
Settings SHALL offer **Automatic**, **Rhino** and **Python only** for modelling. Automatic SHALL use Rhino while it is connected and the Python workbench otherwise. The agent SHALL be offered only the tools the mode in use provides, and the HUD SHALL show the mode in use. The choice SHALL be kept with the workspace.

#### Scenario: Automatic follows the connection
- **GIVEN** the setting is Automatic and Rhino is connected
- **WHEN** Rhino disconnects
- **THEN** the mode in use becomes Python only and the agent's Rhino tools are no longer offered

#### Scenario: Python only on a machine with Rhino
- **GIVEN** Rhino is connected and the setting is Python only
- **WHEN** the agent lists its tools
- **THEN** it has `python_run` and no Rhino tool

#### Scenario: The choice follows the workspace
- **GIVEN** the user set Python only
- **WHEN** the workspace is opened in another browser
- **THEN** the setting is Python only there too
