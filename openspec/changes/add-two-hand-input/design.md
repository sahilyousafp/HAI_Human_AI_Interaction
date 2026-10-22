## Context

The recognizer runs one hand machine per hand and tags every event with its hand. The input router, though, kept a single palette hand and ignored the other hand while a ring was open. The tool controller held one `dragging` and one `pressing` flag, and the viewer emitted one primary pointer plus a grey secondary one. Pointers mapped onto the 3D viewer only, so the sidebar was out of reach, and only buttons marked `data-hand-press` inside the viewer could be pressed.

## Goals / Non-Goals

**Goals:**
- Two equal pointers that each tap, press, scroll and drag.
- A ring per hand.
- Per-hand settings.
- Basic hand-drawn geometry.
- A stop gesture that cannot fire by accident.

**Non-Goals:**
- Two tool drags at once: one tool interaction at a time keeps every change attributable and one undo step.
- Selects and text fields by hand.
- Array, openings, roofs and extrude: these come with `add-modelling-tools`, after the Rhino connector.
- Custom trained gestures.

## Decisions

**Focus hand, not a primary hand.**
- Hover in the model, the section-hover cue and the spoken "this"/"here" need one pointer.
- The focus hand is the one that pinched last, else the right, else the only one visible.
- *Rejected:* a fixed right-hand primary, which keeps the left a second-class pointer. Also rejected: hover under both hands, which would make "this" ambiguous.

**Pointers span the workspace.**
- The gained pinch point (1.3 around the centre) maps onto the visible workspace rectangle, the viewer plus the sidebar.
- It is then expressed in viewer coordinates, which go beyond 0..1 over the sidebar, so tools and picking keep their coordinate system.
- Picking returns nothing outside 0..1.
- Pointers are drawn in a portal on `document.body` at client pixels, so they show over the sidebar.
- E2E tests get the inverse mapping from the page (`__HAI_VIEWER__.handAt`), because it depends on layout.

**Pressable means clickable.**
- `button, a[href], summary, label, input[type=checkbox|radio], [data-hand-press]` are pressable, unless disabled.
- Selects cannot be opened programmatically and text fields need a keyboard, so both stay mouse-only.

**Per-pointer grabs in the controller.**
- Each source (`Left`, `Right` or `mouse`) holds at most one grab: press, scroll or tool.
- Only one source may hold the tool grab. A second hand's drag on the model then navigates.
- A press inside a scrolled area turns into a scroll once the hand moves 2% of the view height vertically.
- *Rejected:* separate controllers per hand, which would duplicate the active tool and its overlay.

**Scroll physics.**
- The content follows the hand 1:1 in screen pixels. The release velocity is measured over the last 100 ms, and a release faster than 0.3 px/ms coasts.
- Coasting decays with a 325 ms time constant, integrated exactly per frame, and stops at the ends.
- Grabbing a coasting area catches it.
- These are the touch-scrolling constants users already know, which is why the view's own flick-to-coast (tuned for camera angles) is not reused.

**Two-hand start rule in the recognizer.**
- Both pinches become a two-hand gesture if they began within `twoHand.startWindowMs` (300 ms) of each other.
- They also do if neither hand has held (a ring) nor started its own drag.
- So "pinch one hand, wait, pinch the other" still navigates while the first is still.
- A hand with a ring open, or one drawing or orbiting, keeps its gesture.
- *Rejected:* telling the worker which hands the app considers busy, which would couple perception to tool state across the worker boundary.

**Stop: two fists, then open hands.**
- Fists are reliably distinct from every other posture and are never held on both hands by accident.
- The sequence (fists for 250 ms, palms within 1 s) keeps the gesture quick.
- The router suppresses both hands' fist actions while both are fists, so the default fist-to-cancel never fires on the way.
- `stopArmed` flows from the recognizer state through the input bus to the HUD.

**Bindings storage.**
- Flat keys (`tap.left`, `hold.right`, `nod`, `stop`) keep the settings file and the `settings.set` message simple.
- `resolveBindings` reads older flat slot keys for both hands, maps the old `palms` key to `stop`, and drops the old single `palette` action, so each hand keeps its own default ring.
- The schema accepts the legacy keys so an old settings file still parses.

**Create tools.**
- One factory, `dragToDraw`, implements Wall and Slab. The draft shows in the overlay (rendered see-through and never picked), the size goes in the notice, and nothing is created until release.
- Elements sit on the ground level, and ends and corners snap to the 100 mm grid.
- Minimum sizes (300 mm) stop accidental slivers.
- Exact dimensions come afterwards by voice or from the agent.

## Risks / Trade-offs

- **Workspace mapping moves the hand's centre** (to the workspace centre, near the viewer's right). The model's left edge needs a little more reach. *Mitigation:* the 1.3 gain still covers the whole width; revisit with a per-region gain if real use shows strain.
- **A hand over the sidebar can press settings by accident.** *Mitigation:* pressing needs engagement and a deliberate pinch, and the outline shows what would be pressed.
- **The 300 ms start window** may split a sloppy two-hand pinch. *Mitigation:* while neither hand is busy the window does not matter, and the value is measured on the recorded clips and documented.
