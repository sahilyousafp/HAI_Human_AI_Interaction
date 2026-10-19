# Tasks

## 1. Scene model

- [ ] 1.1 Define level and element schemas (massing, slab, wall, column) with units and Z-up metadata in `packages/protocol`; verify unit tests for the "invalid element is rejected" scenario
- [ ] 1.2 Implement `apply`, inverse ops and labelled transactions with undo and redo in `packages/scene`; verify the "multi-element transaction" scenario and a property test that apply-then-inverse returns the original document
- [ ] 1.3 Author the sample scene (site, two massing blocks, slabs, walls, columns) as `apps/bridge/samples/mixed-use-block.aex.json`; verify it loads and contains every element type

## 2. Bridge scene store

- [ ] 2.1 Add the scene store to the bridge: snapshot on connect, ordered patches with sequence numbers, resync on gap; verify a unit test with two fake clients for the "two clients stay in sync" scenario
- [ ] 2.2 Add project folder open, debounced atomic save with Windows retry, and remembered last project; verify the "autosave" and "round trip keeps units" scenarios
- [ ] 2.3 Hold selection in the bridge and broadcast it; verify the "selection visible to other clients" scenario

## 3. Viewer

- [ ] 3.1 Render the scene in React Three Fiber (Z-up, off-white materials, edges, sun shadow, ground grid); verify with a Playwright screenshot baseline of the sample scene
- [ ] 3.2 Implement the turntable controller driven by mouse (orbit, pan, zoom) and keyboard undo and redo; verify E2E for "mouse works with tracking on"

## 4. Hand navigation and selection

- [ ] 4.1 Map pinch drag to orbit with elevation clamp; verify unit tests on the controller for "drag right orbits" and "elevation is clamped"
- [ ] 4.2 Map two-hand stream to zoom and pan; verify unit tests for "spread zooms in" and "midpoint move pans"
- [ ] 4.3 Add the hand pointer, hover highlight, tap to select and tap on empty space to clear; verify E2E with a synthetic gesture-event injector for both selection scenarios
- [ ] 4.4 Verify the "navigation while the bridge is down" scenario E2E by stopping the bridge mid-test
- [ ] 4.5 Add gesture-to-render latency measurement and the p90 readout on the HUD; verify E2E that the readout appears and the value is a positive number

## 5. Integration

- [ ] 5.1 Run the full pipeline on the two-hands clip in E2E (camera -> gestures -> camera motion) and assert the camera distance changes; verify it passes in CI
- [ ] 5.2 Document navigation controls and gains in `docs/navigation.md`; verify every control listed works in the demo script

## 6. Demo

- [ ] 6.1 Write `demos/04-navigate.md` (open sample project, engage, orbit, zoom, pan, clutch, select a wall, show latency p90 on the real laptop) and record the Week 4 clip; verify p90 latency is recorded in the script
