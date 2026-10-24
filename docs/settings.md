# Settings

Everything you can set lives in one sheet that slides in from the right, over the model. Open it with the gear at the top right (or Ctrl+,). Close it with its close button or Escape. Your hands reach it too: point at the gear, tap, and press or scroll anything inside, as with the mouse.

The first page lists the sections; each opens its own page with a back button, and the page you used last opens again next time.

| Section | What is there |
|---|---|
| **For recordings** (top of the first page) | **Show my hands**: see below |
| **Camera and tracking** | Which camera, whether its image is mirrored, what is drawn over the preview, the live Gestures and Detection cards, and the frame rate, inference time and backend ([perception.md](perception.md)) |
| **Features** | One switch per feature: see below |
| **Modelling** | How the agent models: Automatic, Rhino or Python only, and what is connected now: see below |
| **Drawing aids** | Grid, Ortho, Endpoint, Midpoint, Centre, Project and Perpendicular for the create tools and Move ([tools.md](tools.md)) |
| **Gestures** | What each gesture does, for each hand where a gesture belongs to one, including what a fist drag does (pan by default) and what a still fist does (cancel) ([gestures.md](gestures.md)) |
| **Tool rings** | The eight slots of the tools ring and of the create ring ([tools.md](tools.md)) |
| **Voice** | Speech to text, listening for names and Mochi's spoken replies ([voice.md](voice.md)) |
| **Agent permissions** | The tools you always allow, to revoke ([agent.md](agent.md)) |

The bridge keeps every setting in `.hai/settings.json` in the workspace, so they follow you across browsers and restarts. A few view choices that only matter on this screen (the camera view expanded or hidden, the last settings page) are kept in this browser.

## Features

Every feature can be switched off on its own, so a demo or a release shows exactly what you want it to. A switched-off feature leaves the interface and ignores its gestures, keys and controls; nothing else changes. Every feature is on until you switch it off, except Number what I point at, which is off until you switch it on.

| Feature | Off means |
|---|---|
| Tool rings | No ring opens by a long pinch, Space or a held right button |
| Create tools | Wall, Slab, Column and Copy disappear from the rings and their keys do nothing; the left hand's create ring does not open; if one was active, Select takes over |
| Two-hand navigation | Pinching with both hands does not zoom, pan or turn the view |
| Scroll by hand | A pinch-drag over a list does not scroll it |
| Press controls by hand | A pinch on a button, switch or link does not press it |
| Snap to buttons | A hand pointer no longer locks onto the nearest button; it must be on a button to press it |
| Nod and shake | Head gestures answer nothing |
| Stop gesture | Both fists then open hands do not stop the agents |
| Voice | No microphone button or indicator, the talk key does nothing, listening for names is off |
| Agent | No agent panel; Ask agent says the agent is switched off |
| Snap to models | A hand pointer must be exactly on a model to select it, and no model lights up before the pinch |
| Number what I point at | Off by default. When on, elements your hand rests on while you speak get numbered markers and count as what you mean |
| Generated panels | The agent is not offered the panel tools, and an open panel closes and drops its preview |
| Latency readout | The status bar does not show the gesture-to-render time |

The list lives in `packages/protocol/src/features.ts`. To put a new feature behind a switch, add it there and check `features.on("<id>")` where the feature acts (a tool can name its feature in `Tool.feature` instead).

## Modelling

The agent can model in two ways, and you choose which in Settings > Modelling ([rhino.md](rhino.md)).

| Choice | The agent works in | The Rhino model |
|---|---|---|
| **Automatic** (the default) | Rhino while it is connected, the Python workbench otherwise | Drawn in the viewer while Rhino is connected |
| **Rhino** | Rhino; it says so when Rhino is not connected | Drawn in the viewer while Rhino is connected |
| **Python only** | The Python workbench, which writes `.3dm` files without Rhino | Not drawn; Rhino's own tools are not offered to the agent |

The page also says what is connected now: the mode in use, the Rhino document, whether Python runs inside Rhino (and what to do when it does not), the progress of a first sync of a large document, and what the viewer leaves out (curves, points, annotations, objects too heavy to draw in full). The top bar shows the same as a pill: **Rhino connected**, **Syncing 120 of 4000**, **Rhino not connected** (when you chose Rhino) or **Python only**, and next to it **Rhino to HAI 80 ms**, how long the last changes in Rhino took to be drawn here.

The choice is kept in `.hai/settings.json` with the others, so it follows the workspace from a machine with Rhino to one without.

## Show my hands

For recordings: your hands are drawn as solid white shapes over the whole screen, each one where its pointer is, so people watching can see what your hands do. The palm is rounded and the fingers tapered; a finger nearer the camera is drawn wider, and a soft shadow lifts the hands off the page. They are drawn at about 85% opacity, so the interface still shows through.

- It is **off** until you switch it on, and the choice is kept for the workspace.
- It is drawn from the tracked hand points only. The camera image is never drawn anywhere but the camera view.
- It never gets in the way: pointers, presses, scrolls and the mouse go straight through it, and the hand pointers stay on top.
- It shows only while the camera is tracking a hand.

## The layout

| Where | What |
|---|---|
| Top | The toolbar: the camera, microphone, Rhino (while it is in use) and bridge indicators, and the settings gear |
| Left | The project bar, then the agent panel |
| Bottom left | The status bar: the active tool, the selection and the latency readout |
| Bottom centre | The section readout with Remove, and the undo strip after an undo |
| Bottom right | The camera view: the preview with the tracked points, Start / Stop, engagement, each hand's state and the last gesture. Expand it over the model, or hide it into a Camera pill; the camera keeps running |
| Right, on demand | The settings sheet |

The look follows your system: light by day, dark when Windows is dark.
