# Tasks

## 1. Hold gesture

- [ ] 1.1 Add `pinch.hold` to the pinch state machine and the gesture event schema; verify the "hold then steer" and "moving pinch never holds" scenarios with synthetic sequences

## 2. Palette core

- [ ] 2.1 Implement the input router (gesture events go to the palette while open, otherwise to tools and navigation); verify unit tests that drag events never reach the controller while the palette is open
- [ ] 2.2 Implement the palette state machine (open, highlight by angle beyond the 4% dead zone, release to choose, centre release cancels); verify "palette opens", "flick right to choose" and "release in the centre cancels" with unit tests
- [ ] 2.3 Render the radial palette overlay and the active-tool HUD indicator; verify a Playwright screenshot baseline of the open palette in light and dark
- [ ] 2.4 Add the fist-hold reset to Select, Space and right-button-hold opening, and per-tool shortcuts; verify "fist returns to Select" and "keyboard opens the palette" E2E

## 3. Registry and settings

- [ ] 3.1 Implement the tool registry with change events; verify "registered tool appears in settings"
- [ ] 3.2 Add palette layout settings persisted in `.aex/settings.json` via the bridge; verify "layout persists" E2E across a reload

## 4. Built-in tools

- [ ] 4.1 Select (default) and Undo/Redo as instant tools; verify "default tool on start" and "undo from the palette"
- [ ] 4.2 Move with 100 mm snapping and drag-on-empty orbit fallback; verify "snapped move" and "drag on empty space orbits"
- [ ] 4.3 Measure with two taps and a mm label; verify "measure a wall" on the sample scene
- [ ] 4.4 Section with a clipping plane, height readout and clear control; verify "lower the section" with a screenshot baseline
- [ ] 4.5 Add massing with snapped placement; verify "place a block"
- [ ] 4.6 Delete with the confirmation helper (nod, shake, Enter, Escape); verify "confirm with nod" and "cancel with shake" with injected gesture events
- [ ] 4.7 Ask agent slot with the not-connected message; verify "no agent yet"

## 5. Docs

- [ ] 5.1 Document the palette, tools, shortcuts and how to register a tool in `docs/tools.md`; verify every shortcut listed matches the registry by a unit test

## 6. Demo

- [ ] 6.1 Write `demos/05-tool-palette.md` (long-pinch, Measure a facade, Section the building, Move a block, Undo, no agent running) and record the Week 5 clip; verify each tool is chosen by a flick in a single attempt on the real camera
