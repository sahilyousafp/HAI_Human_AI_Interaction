# Demo 13 - "Rhino models, I look at HAI"

> Draft: written before the plugin has run in a real Rhino 8. Do a full practice run and fix this script to match what really happens before recording.

Target length 75-90 s, 16:9, captions burned in. Rhino 8 runs minimised in the background. You ask your AI for a canopy and watch it appear in HAI's own viewer, orbit it with your hands, tap a surface and see it selected in Rhino, ask the agent to rotate it and to show it from the south-west, then run a sun-hours study. Last, Rhino is closed and the same kind of work is done from the saved `.3dm`. Show my hands is on.

## Setup (before recording)

1. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme. Claude Code is installed and signed in (the agent panel says Ready).
2. Build and install the plugin (`docs/rhino.md`, Connecting) and run `HaiConnect` in Rhino 8 with an empty document, then **minimise Rhino**. The top bar shows **Rhino connected**, and Settings > Modelling says **Rhino** in use and **Python ready**.
3. Settings > Features: everything on. Show my hands: on. Front light on both hands; Studio Effects off. Start the camera, hold an open palm until engaged.
4. A project folder where `python_run` has been allowed once (so `ladybug-core` and `numpy` are installed and the sun-hours study does not wait for a download). Do one practice run of the whole clip first: the agent writes its own geometry, so the look differs each time.
5. Recorder at 1080p, 30 fps, capturing the browser window only (Rhino is not in frame).

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-8 s | Say: "Architect, model a freeform canopy, six metres square, three metres up." The agent asks to run a script: show the card, with the whole script and no libraries to install. Nod. | "Rhino is minimised. I never look at it." |
| 2 | 8-20 s | The canopy appears in HAI's viewer. The top bar shows **Rhino to HAI** and the number. | "The model is Rhino's, the view is mine." |
| 3 | 20-32 s | Orbit and zoom with both hands. | "Navigation is still my hands." |
| 4 | 32-42 s | Point at the canopy and tap: it highlights. Cut to Rhino for two seconds (restored window): the same surface is selected. Minimise again. | "A tap in HAI selects in Rhino." |
| 5 | 42-54 s | Say: "Rotate this thirty degrees about the vertical, then show it from the south-west." The card, a nod, the canopy turns, the camera swings to the south-west. | "Rotating is a Rhino script. The camera is the agent's." |
| 6 | 54-68 s | Say: "Climate, run a sun-hours study on the canopy for June." Allow the script; a result with hours appears in the chat. | "Ladybug, run inside Rhino." |
| 7 | 68-84 s | Close Rhino. Settings > Modelling shows **Python only** in use. Say: "Product, make a box 2 by 1 by 3 metres and save it." The workbench card, a nod, then **Import into viewer**: the box appears. | "No Rhino at all: the same project, a `.3dm` on disk." |

## Check on the real Rhino and camera (fill in before posting)

- Plugin connected within ___ s of `HaiConnect`; reconnected within 5 s after restarting the bridge: yes / no
- A new object, a moved object, a deleted object and a layer colour change each showed in the viewer: yes / yes / yes / yes
- It worked with Rhino minimised: yes / no
- A tap in HAI selected the object in Rhino ___ / 10 times; selecting in Rhino highlighted it in HAI within 200 ms: yes / no
- **Rhino to HAI p90** for a 50-object edit on this laptop: ______ ms (target: under 300), read from the top bar
- Python in Rhino: a trivial script's overhead ______ ms (target: under 500); one undo reverted a whole run: yes / no
- Which kinds of object did the "Not drawn" row count (curves, blocks...) and was it right: ______

## Check after recording

- No private project names or paths in frame; the cards do not show a personal path.
- The camera swing in shot 5 is visible and finishes before the next cut.
- The captions say what is Rhino's work and what is HAI's.
