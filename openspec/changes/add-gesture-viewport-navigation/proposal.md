# Proposal

## Why

Gestures need something to act on. A built-in 3D viewer with a simple architectural scene gives a zero-install host that anyone can try. It also gives the agent (next change) a model it can read and edit, and turns the gesture vocabulary into the first useful interaction: moving around a building and picking things with your hands.

## What Changes

- A scene model for simple architectural elements (massing blocks, slabs, walls, columns) in millimetres, Z-up, with names, levels and properties. It loads from and saves to a JSON file, and every edit is undoable.
- The bridge holds the authoritative scene and broadcasts changes to the web app, so the agent and the viewer always see the same model.
- A built-in viewer that renders the scene with an architectural look (white model, edges, ground grid, sun shadow).
- Hand navigation: one-hand pinch-drag orbits, two-hand pinch zooms (spread) and pans (move the midpoint), and a fist clutch lets the user reposition.
- A hand pointer (the pinch point) that highlights the element under it; a pinch tap selects it, a tap on empty space clears the selection.
- Mouse and keyboard navigation keep working at all times.
- A sample scene: a small mixed-use block on a site.

Out of scope: agent edits (next change), Rhino (later), IFC import, drawing or sketching with hands.

Demo clip (Week 4): "Orbiting a building with one hand": orbit, zoom, pan, select a wall, all hands-only, with the latency readout visible.

## Capabilities

### New Capabilities

- `scene-model`: the shared architectural scene: element types, units and axes, persistence, selection and undoable transactions.
- `viewport-navigation`: how hands (and mouse) move the camera and point at and select elements in the built-in viewer.

### Modified Capabilities

None.

## Impact

- `packages/scene`: element types, operations, transactions, undo stack (pure TS).
- `packages/protocol`: scene snapshot, scene patch, selection and operation messages.
- `apps/bridge`: scene store, file persistence in a user-chosen project folder, broadcast.
- `apps/web`: React Three Fiber viewer, navigation controller, pointer and selection.
- New dependencies: `three`, `@react-three/fiber`, `@react-three/drei` (all MIT).
