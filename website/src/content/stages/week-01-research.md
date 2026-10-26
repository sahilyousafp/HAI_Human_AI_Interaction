---
order: 1
week: "Week 1"
title: "Teaching my Rhino model to read my hands"
summary: "Before writing any code, a week of research: 20 AEC platforms, 17 vision libraries and 16 datasets, and one rule for the project. Build the hands, not the modeler."
date: 2026-10-19
images:
  - src: "/research/01-thesis.webp"
    alt: "Decision record: build the hands, not the modeler. Own the interaction layer in the browser and let Rhino do the precise geometry through MCP."
    width: 2320
    height: 1500
  - src: "/research/02-decision-matrix.webp"
    alt: "Decision matrix weighing six options on seven criteria. A hybrid of an own browser app plus a Rhino connector scores best."
    width: 2320
    height: 1940
  - src: "/research/03-architecture.webp"
    alt: "System diagram: webcam and mic feed a perception worker and voice, an intent engine and agent chat, then the built-in viewer, a Rhino 8 connector and later Blender."
    width: 2320
    height: 2020
highlights:
  - "No maintained project combines webcam gestures with an AI agent for CAD or BIM"
  - "Google's MediaPipe tracks 21 points on each hand and 478 on the face, in the browser, on a laptop GPU. The video never leaves the machine"
  - "McNeel now ships an official MCP server for Rhino, so an agent can already drive real geometry"
linkedin:
  url: "https://www.linkedin.com/posts/sahil-yousaf-882a0b132_aec-computationaldesign-rhino3d-share-7517887392389767168-JvwU/"
  urn: "urn:li:share:7517887392389767168"
  hook: "I'm teaching my Rhino model to read my hands."
---

The plan: an open-source tool that lets an architect work with an AI agent using hand and head gestures from a normal laptop webcam. Point at a wall, say "make it 300 thick", nod to accept.

So the rule for this project is to build the hands, not the modeler. HAI owns the interaction layer in the browser, and Rhino does the precise work.
