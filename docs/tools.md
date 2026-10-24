# Tools and the tool palette

Many design actions are faster done directly than through the agent: measure a facade, cut a section, draw a wall, nudge a block. The tool palette puts them under your hands. None of these tools need the agent, and every change they make is an ordinary scene transaction, so Undo always reverses it.

## Two rings, one per hand

The palette is two rings of eight tools. The **tools ring** (select, measure, section, move and so on) belongs to the right hand; the **create ring** (wall, slab, column, massing, copy) to the left. Both hands are full pointers otherwise: each can tap, press buttons, scroll and drag, so the left hand can draw a wall while the right orbits the view.

## Opening a ring

| How | Tools ring | Create ring |
|---|---|---|
| Hand | Engage (open palm), then pinch with the right hand and keep it still for a moment (a long pinch). The ring opens around your hand | The same with the left hand |
| Keyboard | Hold Space. The ring opens at the mouse pointer | Hold Shift+Space |
| Mouse | Hold the right button without moving. A right button drag still pans the view | Hold Shift and the right button |

Which ring each hand opens is a setting (the **Gestures** card: Long pinch, per hand).

Then move toward a tool and release (the pinch, Space or the right button). The tool in that direction is highlighted once you are outside the small circle in the middle (4% of the image width); release there to cancel. Each slot keeps its direction, so with practice a quick flick picks a tool without looking.

While a ring is open, the hand that opened it steers it; the other hand keeps working (tapping, pressing, scrolling, orbiting). One ring is open at a time. A long pinch while you are holding something (an element with Move, the section plane with Section, a wall being drawn) keeps holding it instead of opening a ring.

## Getting back out, and the HUD by hand

The active tool is always shown at the bottom left of the view. To leave it and return to Select:

- press its **x** button (with the mouse, or with a hand: point at it and tap with a quick pinch),
- press Escape,
- shake your head,
- or hold a closed fist still for 1.5 s (a fist that moves pans the view instead, see [navigation.md](navigation.md)).

Escape and a head shake first close an open palette, answer "keep" to a question, or drop a drag in progress; the next one returns to Select. A shake that skips the agent's panel offer, or denies its approval card, leaves the active tool as it is. A nod or shake answers what waits for one in this order: a spoken request under review, an approval card, a panel offer, then the tool's question (the full rules are in [gestures.md](gestures.md)).

Hands reach the whole window, the model, the toolbar, the camera view and the settings alike, and press what the mouse clicks: buttons, links, checkboxes and their labels (dropdowns and text fields stay mouse and keyboard). Point at a control so it gets an outline and the pointer shrinks to a dot, then pinch and let go. Any pinch that starts on a control presses it, however long you hold it; it never grabs or orbits. After an undo or redo, a strip says what was undone and offers **Undo again** and **Redo**, so stepping back several changes takes a few taps.

**The agent's panel offers.** When your request is about a tolerance or a range, the agent may offer a small panel for it: a card in the agent panel with **Open** and **Skip**. Press either, or nod to open and shake to skip. The panel floats over the model, never blocks orbiting, panning or zooming outside it, and the model under it is not picked through it. Its header drags it around the window; **Done** keeps what you changed as one undo step and **Close** puts the model back. Hands press its Done and Close and the controls inside it (see [agent.md](agent.md#generated-panels)).

**Pointers snap to buttons.** A hand pointer within about 28 pixels of a button locks onto it: the pointer is drawn on the button, the button is outlined, and a pinch presses it. It lets go when your hand is more than 44 pixels away, so it does not flicker between neighbours. A pinch that starts on a locked button keeps it however far your hand drifts while the fingers close, and a pinch that starts on the model (an orbit, a drag with a tool) never locks onto a button on the way past. Each hand snaps on its own, the mouse is never snapped, and **Settings > Features > Snap to buttons** turns it off.

**Scrolling by hand.** Pinch over a list that scrolls (the agent conversation, the extensions, the settings) and move the hand up or down: the content follows the hand, as on a phone. Let go while moving and it coasts on and slows down; pinching it again catches it. A pinch that starts on a button inside the list presses the button, unless the hand moves up or down first (2% of the view's height), which scrolls instead.

## The pointers

Each hand has its own pointer, in the hand's colour in the camera overlay (left amber, right blue), and it shows what a pinch would do where it is. Hover in the model and what "this" means when you speak follow the hand that pinched last.

| Pointer | Meaning |
|---|---|
| Plain ring | Select: tap selects, a drag orbits |
| Ring with the tool's icon (red for Delete) | The active tool acts here |
| Rounded square with up and down arrows | Over the section plane (with Section) or its outline (with any tool): pinch to grab it and drag |
| Small dot | Over a control (tap to press), or this hand's ring is open (steer and release) |
| Dashed grey ring | Tracking sees your hand but you are not engaged: show an open palm |

The mouse cursor changes with the tool as well. The pointer stays put through brief tracking dropouts instead of blinking out.

## Tools

| Tool | Key | Default slot | What it does |
|---|---|---|---|
| Select | V | Top (tools) | Tap selects the element under the pointer; tap on empty space clears. Drags orbit the view |
| Ask agent | A | Top right (tools) | Opens the agent panel on the conversation and starts listening (see [agent.md](agent.md)). If the agent is not available, it says why |
| Measure | D | Right (tools) | Tap two points: the distance between them is shown in millimetres (rounded to 1 mm) with its across and up parts, for example `4123 mm (2828 across, 3000 up)`. Each point snaps to the model through the drawing aids (an end, a middle, a centre, at any height) and shows its marker while you hover; with no snap in reach it is the surface point under the pointer. Changes nothing |
| Section | S | Bottom right (tools) | The cut is a plane you can grab: pinch on it (it lights up under the pointer) and drag down to cut lower, up to cut higher; the height is shown in millimetres. A drag off the plane orbits. The section stays when you change tool, until you press Remove (or tap the plane with Delete). From any other tool, its outline can still be grabbed and dragged, and tapping the outline selects the section |
| Move | M | Bottom (tools) | Pinch an element and drag it along the ground; it snaps to 100 mm (or to the drawing aids) and is moved in one "Move" transaction when you let go. A drag that starts on empty space orbits instead |
| Add massing | B | Bottom left (tools), Bottom right (create) | Tap the ground: a 6000 x 6000 x 3500 mm block is placed there, centred on the tap and snapped to 100 mm |
| Delete | X | Left (tools), Top left (create) | Tap an element: it turns red and asks you to confirm. Nod or press Enter to delete it; shake your head or press Escape to keep it. Tapping the section plane removes the section |
| Undo | U | Top left (tools), Left (create) | Undoes the last change at once and keeps your current tool; Undo again on the strip that appears steps further back |
| Redo | R | Bottom left (create) | Redoes at once and keeps your current tool |
| Wall | W | Top (create) | Pinch on the ground and drag from one end of the wall to the other: the wall shows as you drag, with its length, and is added when you let go (200 mm thick, 3000 mm high, ends snapped to 100 mm). Shorter than 300 mm adds nothing |
| Slab | F | Top right (create) | Pinch on the ground and drag from one corner to the opposite one: a 200 mm slab fills the rectangle (sides at least 300 mm, corners snapped to 100 mm) |
| Column | C | Right (create) | Tap the ground: a 400 x 400 mm column, 3000 mm high, is placed there, snapped to 100 mm |
| Copy | P | Bottom (create) | Pinch an element and drag: a copy follows, snapped to 100 mm, and is added where you let go; the original stays. A drag that starts on empty space orbits instead |

Everything the create tools add sits on the ground level and is one undo step, named after the element ("Add Wall 3"). Exact sizes come afterwards: select the element and say "make this 300 thick", or ask the agent.

Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y keep working as before.

## Placing points exactly: drawing aids

Wall, Slab, Column, Copy and Move put their points through the **drawing aids** in **Settings > Drawing aids**. Each is a switch; only Grid is on until you turn the others on, and a change applies to the very next point. The status bar lists the aids that are on.

| Aid | What it does |
|---|---|
| Grid | Points land on a 100 mm grid (what the tools always did) |
| Ortho | A line is held to the X axis, the Y axis or 45 degrees from where it starts, once your hand is within 7.5 degrees of one; otherwise it stays free. The notice shows the length and the angle |
| Endpoint | Snaps to the ends of walls, the corners of slabs, the centres of columns, and the corners of massings and imported models |
| Midpoint | Snaps to the middle of a wall or of an edge of a slab, a massing or an imported model |
| Centre | Snaps to the centre of a slab, a massing, an imported model or a column |
| Project | Carries the point onto the nearest edge of the model, so a new wall can start anywhere along an old one |
| Perpendicular | Ends a line where it meets an edge at a right angle |

Snaps work **at every height**: candidates are the real points of the model, at the base and the top of walls and columns, at the top of slabs, and at the bottom and the top of massings and imported models, and the pointer is matched to them where they appear on screen, within 24 pixels, whatever the zoom and however high they are. A wall end three floors up, or the top corner of an imported building, snaps when it is under the pointer on screen, even if it is hidden behind something. A line started on a snapped point is drawn in the plane at that height, and the new element is placed at it: on the level whose elevation matches (within 1 mm), else with no level and its own base height. When more than one could apply, the first of Endpoint, Midpoint, Centre, Perpendicular and Project that is within reach wins, and Grid takes what is left. With Ortho on, only a snap that lies on the held line counts (Project then means where the line meets the edge). The snapped point shows a ring and the aid's name, and the notice repeats it, for example "Wall 5000 mm at 0 deg (Endpoint)". The first point of a line and of a slab take the point snaps; Ortho and Perpendicular need a start, so they apply to the end of a wall, not to a slab's opposite corner.

Move and Copy carry one point of the element (a column's centre, a wall's start, a massing's origin corner, a slab's first corner, an imported model's lowest corner) to the snap. With only Grid on they move by whole 100 mm steps, as before, so the element keeps its own alignment.

## Choosing the layout

**Settings > Tool rings** has a switch between the two rings, listing its eight slots clockwise from the top. Pick any registered tool for each slot, or leave it empty. The layouts are saved by the bridge in `.hai/settings.json` in the workspace, so they are the same in every browser and after a restart.

## Adding a tool

Tools are plain objects registered in the tool registry (`apps/web/src/tools/registry.ts`). A registered tool can be placed in any slot and gets its keyboard shortcut straight away; the palette itself needs no change. The Rhino connector and plugins add their tools this way.

```ts
import type { Tool } from "./tools/types.ts";

const bakeTool: Tool = {
  id: "rhino-bake",
  label: "Bake to Rhino",
  icon: "M4 4h16v16H4z", // SVG path data for a 24 x 24 stroked icon
  shortcut: "k", // one key, not used by another tool
  onTap(ctx, _at, hit) {
    if (hit) ctx.flash(`Baking ${hit.elementId}`);
  },
};
registry.register(bakeTool);
```

A tool can implement any of these; the `ctx` it receives reads and changes the scene (`doc`, `apply`, `undo`, `redo`, `select`), looks into the view (`pick`, `ground`, `bounds`), draws on it (`overlay`, `setOverlay`, `flash`), places points with the drawing aids (`aids`, `mmPerPixel`, `resolve`, `clearSnap`) and asks for confirmation (`confirm`).

| Member | When it is called |
|---|---|
| `activate`, `deactivate` | The tool becomes active, or another tool does |
| `onHover(ctx, at)` | The pointer moved (hand or mouse), for hover feedback |
| `onTap(ctx, at, hit)` | A tap or click; `hit` is the element and point under it, or null |
| `onDragStart(ctx, at, hit)` | A drag begins. Return true to take it; otherwise the view orbits |
| `onDrag`, `onDragEnd` | The drag moves and ends |
| `onDragCancel` | The drag was taken over (the palette opened) or the user disengaged: undo any preview, commit nothing |
| `instant` and `run(ctx)` | Instant tools (like Undo) run once and leave the current tool active |

Positions (`at`) are viewer coordinates, 0 to 1 across and down the 3D view, whether they come from a hand, the mouse or a test.
