# Proposal

## Why

The only "line" was Sketch line, a freehand path for the agent, so a line could not be drawn straight, held to an axis or given a length. Ortho only engaged within 7.5 degrees of an axis, so a hand that wobbled slipped free of it, and the only switches were buried in Settings. There was no way to look at the model in plan or elevation either: the camera was a perspective turntable that never reached straight down.

## What Changes

- **A new `line` model element and a Line tool.** A line is a polyline through points at their real heights (open or closed), a curve and not a solid.
  - A tap places each point and the segment follows the pointer through the drawing aids, with its length and angle shown.
  - Tapping the last point again, a nod or Enter finishes it; tapping the first point closes it; Escape or a shake takes back the last point. It is one undo step.
  - Lines are drawn as thin tubes, snap by their vertices and spans, move and copy like any element, are saved to `.3dm` as polyline curves on a Lines layer, and are known to the agent's scene tools.
  - Say "line" to pick it (Sketch line is "sketch line" or "path"); it sits in the reference ring's free slot, key N.
- **Ortho is a hard lock with an angle step.** With Ortho on, a segment always takes the nearest angle of its step (90, 45 or 15 degrees, 45 by default, remembered), however far the hand is from it.
- **A length can be set** for the next segment of a Line or Wall: the point lies exactly that far along the Ortho direction, or towards the pointer without Ortho, and snaps and the grid do not move it.
- **A constraints panel** at the viewport's right while Line or Wall is active: Ortho and its step, the length (typed and locked), and the point snaps as chips, all hand-pressable and the same switches as Settings > Drawing aids.
- **A view cube and true orthographic views.** A cube that turns with the camera, whose faces switch to Top, Bottom, Front, Back, Left and Right, with Perspective to return. Orbiting leaves an orthographic view; panning and zooming keep it.
- **Drawing in a side view.** In Front, Back, Left and Right the Line tool draws in the vertical plane through its first point; Ortho, a length and the Endpoint, Midpoint, Centre and Grid snaps work there. Plan tools place nothing in a side view.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `scene-model`: a `line` element.
- `direct-tools`: the Line tool, Ortho as a hard lock with an angle step, a length for a segment, the constraints panel.
- `viewport-navigation`: the view cube and orthographic views.

## Impact

- `packages/protocol`: `LineElement` in `scene.ts`; the reference ring's default layout.
- `packages/scene`: `bounds.ts`, `snap.ts` (angle step, length, side-plane resolution), `extrusions.ts`, the new `views.ts`.
- `apps/web`: the Line tool, constraints in the tool controller, `ConstraintsPanel.tsx`, `ViewCube.tsx`, the orthographic camera and work plane in `Viewer.tsx`, the line geometry and the `.3dm` export.
- `apps/bridge`: the agent's scene tools and prompts describe lines.
- Not changed: the agent's `set_view` has no orthographic views yet.
