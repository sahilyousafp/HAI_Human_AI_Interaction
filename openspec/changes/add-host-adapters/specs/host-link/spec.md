# Spec Delta

## Purpose

Connects any host application (Rhino, Blender, Revit) to the bridge through one contract. The host's model is drawn in HAI's own viewer, steered by the same gestures as any other model, and picks and selections go both ways. The host does the modelling, and its window is optional.

## ADDED Requirements

### Requirement: One command connects a host to the bridge
A host's connector SHALL connect to the running bridge with one command or button in the host (`HaiConnect` in Rhino), without the user copying any token. If the bridge is not running, it SHALL say so and how to start it.

#### Scenario: Connect
- **GIVEN** the bridge is running
- **WHEN** the user runs `HaiConnect` in Rhino
- **THEN** Rhino's command line reports "Connected to HAI" and the HUD shows Rhino as connected

#### Scenario: Bridge not running
- **WHEN** the user runs `HaiConnect` and no bridge is running
- **THEN** the command line says the bridge is not running and how to start it

### Requirement: A host says who it is and what it can do
A host SHALL open its connection with a hello naming the host (`rhino`, `blender` or `revit`), the protocol version, its application and version, and what it can do: the languages it runs, capture, placing images and API lookup. The bridge SHALL refuse a hello without a protocol version or with an older one, and tell the host to update its connector.

#### Scenario: An old plugin is refused
- **WHEN** a Rhino plugin that sends the old hello without a protocol version connects
- **THEN** the bridge refuses it with a message to install the new plugin, and the HUD does not show Rhino as connected

#### Scenario: Any host id connects with the token
- **WHEN** a client without a browser origin presents the token and says it is `blender`
- **THEN** the bridge accepts it as the Blender host

### Requirement: The link survives bridge restarts
While connected, a host's connector SHALL reconnect automatically within 5 seconds after the bridge restarts, until the user disconnects it.

#### Scenario: Bridge restart
- **GIVEN** Rhino is connected
- **WHEN** the bridge restarts
- **THEN** Rhino is connected again within 5 seconds without user action

### Requirement: Every host's model is drawn in HAI's viewer
While a host is connected and switched on, the objects in its open document SHALL be drawn in the viewer as a layer of that host, in the host's own colours, whoever made them. Adding, changing, moving, recolouring and deleting an object in the host SHALL show in the viewer. The host's window MAY be minimised. Two connected hosts SHALL be drawn at the same time, each as its own layer.

#### Scenario: A new object appears
- **GIVEN** Rhino is connected with the viewer open
- **WHEN** an approved run adds a lofted surface in Rhino
- **THEN** the surface is drawn in the viewer

#### Scenario: A moved object follows
- **WHEN** the user moves an object with the mouse in Rhino
- **THEN** the viewer draws it at its new place

#### Scenario: A deleted object goes
- **WHEN** an object is deleted in Rhino
- **THEN** it is no longer drawn in the viewer

#### Scenario: Two hosts at once
- **GIVEN** a fake Rhino host and a fake Blender host are connected, each with one object
- **WHEN** the viewer draws
- **THEN** both objects are drawn, and a pick on each reports its own host

#### Scenario: A host disconnects
- **WHEN** a host disconnects
- **THEN** that host's layer disappears from the viewer and the other hosts' layers stay

### Requirement: A host's layer is not part of the HAI scene
A host's layer SHALL NOT be saved with the HAI project, SHALL NOT be in HAI's undo history and SHALL NOT be changed by the scene tools. The host owns its objects.

#### Scenario: The mirror is not the scene
- **GIVEN** host objects are drawn in the viewer
- **WHEN** the user saves the HAI project and then undoes in HAI
- **THEN** the saved scene holds no host object and the undo does not change any host layer

### Requirement: Changes in a host reach HAI quickly
A change in a host SHALL be drawn in the viewer within 300 ms (90th percentile) for edits of up to 50 objects. The HUD SHALL show, per host, the measured time from the change to the drawn frame. The first sync of a large document SHALL arrive progressively, smaller objects first, with the HUD showing how many of how many objects are in.

#### Scenario: Latency readout
- **WHEN** objects are edited in Rhino
- **THEN** the HUD's Rhino chip shows a p90 in milliseconds

#### Scenario: A large model arrives progressively
- **GIVEN** a document with 5000 objects
- **WHEN** the host connects
- **THEN** the viewer starts drawing before all objects have arrived and the HUD shows how many have

### Requirement: What is not drawn is counted
Curves, points and annotations SHALL NOT be drawn in the viewer, and an object too heavy to mirror in full SHALL be drawn as its bounding box. The HUD SHALL count both per host, so that a missing object is explained.

#### Scenario: Curves are counted
- **GIVEN** the document holds 12 curves and 40 surfaces
- **WHEN** it is mirrored
- **THEN** the 40 surfaces are drawn and the HUD says 12 curves are not drawn

### Requirement: Picking in HAI selects in the owning host
A pinch tap, or a mouse click, on a mirrored object SHALL select that object in its own host and clear the selection in the other hosts. A tap on empty space SHALL clear every host's selection.

#### Scenario: Tap selects a Rhino object
- **GIVEN** a Rhino surface is drawn in the viewer
- **WHEN** the user performs a pinch tap on it
- **THEN** that surface is selected in Rhino and highlighted in the viewer

### Requirement: A host's selection is mirrored
Whenever a host's selection changes, by hand, mouse or agent, the bridge SHALL hold the selected object ids for that host within 200 ms, and the viewer SHALL highlight those objects.

#### Scenario: Mouse selection mirrored
- **WHEN** the user selects two objects with the mouse in Rhino
- **THEN** the bridge reports those two object ids as Rhino's selection and the viewer highlights them

### Requirement: A host's status is shown
A host SHALL report whether it can run code for the agent (`ready` or `unavailable`, with a reason), when it connects and whenever that changes. The HUD SHALL show it on the host's chip, and when it is unavailable SHALL say why and how to fix it. The agent SHALL NOT be offered `host_run` for a host that cannot run code.

#### Scenario: Run unavailable
- **GIVEN** Rhino is connected and reports that Python 3 cannot run, with a reason
- **WHEN** the user opens Rhino's status
- **THEN** it shows that the agent cannot run code in Rhino, with the reason and how to fix it, and the agent's `host_run` does not offer Rhino

### Requirement: The user chooses which hosts the agent uses
Settings > Hosts SHALL have one switch per host, on by default. A host that is switched off SHALL NOT be drawn and SHALL NOT be offered to the agent, even while connected. The choice SHALL be kept with the workspace. A workspace that had chosen Python only SHALL open with Rhino switched off.

#### Scenario: Switch a host off
- **GIVEN** Rhino is connected
- **WHEN** the user switches Rhino off
- **THEN** its layer disappears and the agent's host tools no longer offer Rhino

#### Scenario: An old Python only choice
- **GIVEN** a workspace whose settings say modelling is Python only
- **WHEN** the bridge starts
- **THEN** Settings > Hosts shows Rhino switched off and the other hosts on
