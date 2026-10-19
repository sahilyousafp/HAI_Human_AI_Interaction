# LinkedIn post 01 - kickoff (Week 1)

## Post

I'm teaching my Rhino model to read my hands.

For the next 12 weeks I'm building an open-source tool that lets an architect work with an AI agent using hand and head gestures from a normal laptop webcam. Point at a wall, say "make it 300 thick", nod to accept.

Before writing any code I spent the week on research: 20 AEC platforms, 17 vision libraries, 16 datasets.

Three things stood out:
- I couldn't find a single maintained project that combines webcam gestures with an AI agent for CAD or BIM.
- Google's MediaPipe tracks 21 points on each hand and 478 on the face, in the browser, on a laptop GPU. The video never leaves the machine.
- McNeel now ships an official MCP server for Rhino, so an agent can already drive real geometry.

So my rule for this project: build the hands, not the modeler. I own the interaction layer in the browser and Rhino does the precise work.

Twice a week I'll share what I built, including the parts that break.

If you work in AEC, computational design or HCI: what would you control with your hands first?

Links in the first comment.

@Robert McNeel & Associates @Anthropic @Google for Developers

#AEC #ComputationalDesign #Rhino3D #AI #OpenSource #BuildInPublic

## First comment

Where this starts:
- Decision record (interactive): <share link from the artifact page>
- Rhino MCP by McNeel: https://github.com/mcneel/RhinoAI
- MediaPipe hand tracking: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker
- HaGRID gesture dataset (1M images): https://github.com/hukenovs/hagrid
- Repo: going public with week 2's post

## Images (in this folder, upload in this order)

1. 01-thesis-dark.png - the thesis and title block
2. 04-pinch-detail-dark.png - the 21-landmark pinch test
3. 03-architecture-dark.png - the system diagram

Light versions are also here if your feed leans light.

## Alternative hooks

- "My laptop webcam is about to become my 3D mouse."
- "I gave myself 12 weeks and 6 hours a week to build hand-controlled AI design tools. Week 1: no code, just research."
