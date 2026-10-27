# Tools and the tool palette

Many design actions are faster done directly than through the agent: measure a facade, cut a section, nudge a block, point out where something should go. The tool palette puts them under your hands. None of these tools need the agent, and every change they make to the model is an ordinary scene transaction, so Undo always reverses it.

## Two rings, one per hand

The palette is two rings of eight tools, set out by what each hand is for:

- The **action ring** belongs to the hand you draw with (your dominant hand, the right one unless you change it): Select, Move, Copy, Delete, Undo, Wall, Slab and Column, the tools that act on the model.
- The **reference ring** belongs to the other hand: Sketch line, Sketch area, Place marker, Measure, Add massing and Section, the tools that point things out, for you and for the agent. Two slots are free for your own choice.

Both hands are full pointers otherwise: each can tap, press buttons, scroll and drag, so one hand can draw a wall while the other orbits the view. Left-handed? Set **Dominant hand** to Left in **Settings > Tool rings** and the rings swap hands.

Every tool also has a spoken name, shown under its icon in the ring: say just that word ("wall", "area", "measure", "undo") and the tool is picked at once, without the agent (see [voice.md](voice.md#tool-names)).

## Opening a ring

A long pinch (engage with an open palm, then pinch and keep the hand still for a moment) is **hold to talk**: the microphone listens while you hold, about what was under your hand (see [gestures.md](gestures.md#hold-to-talk)). When you hold without speaking, the hand's ring fades in around it after 0.6 s, and you can flick to a tool at once, before it shows.

| How | Action ring | Reference ring |
|---|---|---|
| Hand | A silent long pinch of your dominant hand. The ring opens around your hand | A silent long pinch of your other hand |
| Keyboard | Hold Space. The ring opens at the mouse pointer | Hold Shift+Space |
| Mouse | Hold the right button without moving. A right button drag still pans the view | Hold Shift and the right button |

To have a long pinch open a ring at once, without listening, set it to **Open the action ring** or **Open the reference ring** in the **Gestures** card (Long pinch, per hand).

Then move toward a tool and release (the pinch, Space or the right button). The tool in that direction is highlighted once you are outside the small circle in the middle (4% of the image width); release there to cancel. Each slot keeps its direction, so with practice a quick flick picks a tool without looking. If you start speaking, the ring hides and your hand points instead: what you say wins.

While a ring is open, the hand that opened it steers it; the other hand keeps working (tapping, pressing, scrolling, orbiting). One ring is open at a time. A long pinch while you are holding something (an element with Move, the section plane with Section, a wall or a sketch being drawn) keeps holding it instead of opening a ring or listening.

### What moved

| Before | Now |
|---|---|
| Tools ring (right hand) and create ring (left hand) | Action ring (dominant hand) and reference ring (other hand) |
| Wall, Slab and Column on the left hand | On the action ring, the hand you draw with |
| Measure and Section on the right hand | On the reference ring |
| Ask agent in a slot | A long pinch is the way to ask; Ask agent keeps its A key |
| Redo in a slot | On the undo strip, the R key and by saying "redo" |
| Undo, Delete and Add massing in both rings | Once each |

A layout you changed yourself is kept as it was. To get the old ring-only long pinch back, set Long pinch to open a ring in the Gestures card.

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
| Select | V | Top (action) | Tap selects the element under the pointer; tap on empty space clears. Drags orbit the view |
| Ask agent | A | (not in a ring) | Opens the agent panel on the conversation and starts listening (see [agent.md](agent.md)). If the agent is not available, it says why |
| Measure | D | Bottom right (reference) | Tap two points: the distance between them is shown in millimetres (rounded to 1 mm) with its across and up parts, for example `4123 mm (2828 across, 3000 up)`. Each point snaps to the model through the drawing aids (an end, a middle, a centre, at any height) and shows its marker while you hover; with no snap in reach it is the surface point under the pointer. Changes nothing |
| Section | S | Bottom left (reference) | The cut is a plane you can grab: pinch on it (it lights up under the pointer) and drag down to cut lower, up to cut higher; the height is shown in millimetres. A drag off the plane orbits. The section stays when you change tool, until you press Remove (or tap the plane with Delete). From any other tool, its outline can still be grabbed and dragged, and tapping the outline selects the section |
| Move | M | Top right (action) | Pinch an element and drag it along the ground; it snaps to 100 mm (or to the drawing aids) and is moved in one "Move" transaction when you let go. A drag that starts on empty space orbits instead |
| Add massing | B | Bottom (reference) | Tap the ground: a 6000 x 6000 x 3500 mm block is placed there, centred on the tap and snapped to 100 mm |
| Delete | X | Bottom right (action) | Tap an element: it turns red and asks you to confirm. Nod or press Enter to delete it; shake your head or press Escape to keep it. Tapping the section plane removes the section; tapping a sketch or a marker removes it without asking |
| Undo | U | Bottom (action) | Undoes the last change at once and keeps your current tool; Undo again on the strip that appears steps further back |
| Redo | R | (not in a ring) | Redoes at once and keeps your current tool |
| Wall | W | Left (action) | Pinch on the ground and drag from one end of the wall to the other: the wall shows as you drag, with its length, and is added when you let go (200 mm thick, 3000 mm high, ends snapped to 100 mm). Shorter than 300 mm adds nothing |
| Slab | F | Top left (action) | Pinch on the ground and drag from one corner to the opposite one: a 200 mm slab fills the rectangle (sides at least 300 mm, corners snapped to 100 mm) |
| Column | C | Bottom left (action) | Tap the ground: a 400 x 400 mm column, 3000 mm high, is placed there, snapped to 100 mm |
| Copy | P | Right (action) | Pinch an element and drag: a copy follows, snapped to 100 mm, and is added where you let go; the original stays. A drag that starts on empty space orbits instead |
| Sketch line | L | Top (reference) | Pinch and drag to draw a path for the agent, through the drawing aids. It shows dashed in your hand's colour, labelled S1, S2 and so on, and is not part of the model. Shorter than 300 mm keeps nothing. Up to 8 sketches are kept; a request carries them all and clears them, and Escape with a sketch tool active clears them too |
| Sketch area | E | Top right (reference) | Pinch and drag around an area: the outline closes when you let go and shows dashed and lightly filled, labelled like a path. Less than a square metre keeps nothing |
| Place marker | K | Right (reference) | Tap to place a lettered marker (the first free letter, A to Z); tap a marker to remove it. Markers are kept with the project and every request tells the agent where they are |

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

**Settings > Tool rings** has a switch between the action ring and the reference ring, listing its eight slots clockwise from the top. Pick any registered tool for each slot, or leave it empty. **Dominant hand** (Right or Left) decides which hand's silent long pinch shows which ring. The layouts and the dominant hand are saved by the bridge in `.hai/settings.json` in the workspace, so they are the same in every browser and after a restart.

## Adding a tool

Tools are plain objects registered in the tool registry (`apps/web/src/tools/registry.ts`). A registered tool can be placed in any slot and gets its keyboard shortcut straight away; the palette itself needs no change. The Rhino connector and plugins add their tools this way.

```ts
import type { Tool } from "./tools/types.ts";

const bakeTool: Tool = {
  id: "rhino-bake",
  label: "Bake to Rhino",
  icon: "M4 4h16v16H4z", // SVG path data for a 24 x 24 stroked icon
  shortcut: "j", // one key, not used by another tool
  spoken: ["bake"], // say "bake" to pick it; the first is shown in the ring
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
