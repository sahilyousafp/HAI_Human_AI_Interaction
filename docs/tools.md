# Tools and the tool palette

Many design actions are faster done directly than through the agent: measure a facade, cut a section, nudge a block, point out where something should go. The tool palette puts them under your hands. None of these tools need the agent.

HAI edits; it does not build. The model is made in the host applications (Rhino, Blender, Revit, see [hosts.md](hosts.md)), and the tools here select, move, turn and delete what is in it: a host's mirrored objects and HAI's own elements alike. A move of a Rhino object is made in Rhino, as one undo step there, and HAI's Undo takes it back. Anything more than that ("make it 300 thick", "copy this along the street") is asked of the agent, which has the host do it.

## Two rings, one per hand

The palette is two rings of eight tools, set out by what each hand is for:

- The **edit ring** (the action ring) belongs to the hand you work with (your dominant hand, the right one unless you change it): Select, Move, Rotate, Delete, Undo, Redo, Measure and Section, the tools that act on the model.
- The **reference ring** belongs to the other hand: Sketch line, Sketch area, Place marker, Lasso select and Ask agent, the tools that point things out, for you and for the agent. Its other three slots are free for your own choice.

Both hands are full pointers otherwise: each can tap, press buttons, scroll and drag, so one hand can move an object while the other orbits the view. Left-handed? Set **Dominant hand** to Left in **Settings > Tool rings** and the rings swap hands.

Every tool also has a spoken name, shown under its icon in the ring: say just that word ("rotate", "area", "measure", "undo") and the tool is picked at once, without the agent (see [voice.md](voice.md#tool-names)).

## Opening a ring

A long pinch (engage with an open palm, then pinch and keep the hand still for a moment) is **hold to talk**: the microphone listens while you hold, about what was under your hand (see [gestures.md](gestures.md#hold-to-talk)). When you hold without speaking, the hand's ring fades in around it after 0.6 s, and you can flick to a tool at once, before it shows.

| How | Action ring | Reference ring |
|---|---|---|
| Hand | A silent long pinch of your dominant hand. The ring opens around your hand | A silent long pinch of your other hand |
| Keyboard | Hold Space. The ring opens at the mouse pointer | Hold Shift+Space |
| Mouse | Hold the right button without moving. A right button drag still pans the view | Hold Shift and the right button |

To have a long pinch open a ring at once, without listening, set it to **Open the action ring** or **Open the reference ring** in the **Gestures** card (Long pinch, per hand).

Then move toward a tool and release (the pinch, Space or the right button). The tool in that direction is highlighted once you are outside the small circle in the middle (4% of the image width); release there to cancel. Each slot keeps its direction, so with practice a quick flick picks a tool without looking. If you start speaking, the ring hides and your hand points instead: what you say wins.

While a ring is open, the hand that opened it steers it; the other hand keeps working (tapping, pressing, scrolling, orbiting). One ring is open at a time. A long pinch while you are holding something (an object with Move, the section plane with Section, a sketch being drawn) keeps holding it instead of opening a ring or listening.

### What moved

| Before | Now |
|---|---|
| Wall, Slab, Column, Copy, Add massing and Line | Gone: the hosts model. Ask the agent ("a wall along this sketch") and it has the host build it |
| Action ring: Select, Move, Copy, Delete, Undo, Wall, Slab, Column | Edit ring: Select, Move, Rotate, Delete, Undo, Redo, Measure, Section |
| Reference ring: Sketch line, Sketch area, Place marker, Measure, Add massing, Section, Line, Lasso select | Sketch line, Sketch area, Place marker, Lasso select, Ask agent, and three free slots |
| Settings > Features > Create tools | Gone with the tools |

A layout you changed yourself keeps its tools where they were; a slot that held a removed tool is left empty. A layout still equal to an old default takes the new one.

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

Move, Rotate and Delete work the same on a host's objects as on HAI's own elements, with the same gestures. While you drag, the object is drawn where it goes; when you let go the edit is sent to its host, which makes it as one undo step ("HAI: Move" in Rhino's undo list). The object stays where you put it until the host's result arrives, so nothing jumps back. If the host refuses (the object was deleted there meanwhile) or does not answer within 5 seconds, the object goes back and a notice says why. A host that cannot take edits (an older connector) says so the same way.

| Tool | Key | Default slot | What it does |
|---|---|---|---|
| Select | V | Top (action) | Tap selects the element or host object under the pointer, with the rest of its group; tap on empty space clears. A host object selects in its host too. Drags orbit the view |
| Ask agent | A | Bottom (reference) | Opens the agent panel on the conversation and starts listening (see [agent.md](agent.md)). If the agent is not available, it says why |
| Rotate | O | Right (action) | A drag turns what is selected, or the element, group or host object it starts on, about the centre of its plan box, as one body. The turn shows as you drag, with its angle at the pivot, in whole degrees or in the angle step when Ortho is on, and is one undo step when you let go. A tap chooses what to turn. With nothing under the drag and nothing selected the view orbits. Say "rotate" or "turn" to pick it |
| Measure | D | Left (action) | Tap two points: the distance between them is shown in millimetres (rounded to 1 mm) with its across and up parts, for example `4123 mm (2828 across, 3000 up)`. Each point snaps to the model through the drawing aids (an end, a middle, a centre, at any height) and shows its marker while you hover; with no snap in reach it is the surface point under the pointer. Changes nothing |
| Section | S | Top left (action) | The cut is a plane you can grab: pinch on it (it lights up under the pointer) and drag down to cut lower, up to cut higher; the height is shown in millimetres. A drag off the plane orbits. The section stays when you change tool, until you press Remove (or tap the plane with Delete). From any other tool, its outline can still be grabbed and dragged, and tapping the outline selects the section |
| Move | M | Top right (action) | Pinch an element or a host object and drag it along the ground; it snaps to 100 mm (or to the drawing aids) and is moved in one "Move" transaction when you let go. With several elements selected, a drag that starts on one of them carries all of them (one undo step); a pinch on an element that is not selected moves only that one. A line's points show as handles while Move is active: a pinch on one moves that point through the drawing aids, keeping its height unless it snaps ("Move point", one undo step), and a pinch along the line moves the whole line. A drag that starts on empty space orbits instead |
| Delete | X | Bottom right (action) | Tap an element or a host object: it turns red, with the rest of its group or the selection it is part of, and asks once you to confirm. Nod or press Enter to delete it; shake your head or press Escape to keep it. Tapping the section plane removes the section; tapping a sketch or a marker removes it without asking. A line's points show as handles while Delete is active: a tap on one removes that point at once ("Delete point", one undo step; a closed line left with two points opens, and removing one of a line's last two asks about the whole line). A tap along the line asks to delete all of it |
| Undo | U | Bottom (action) | Takes back your last edit at once, wherever you made it (in HAI's scene or in a host), and keeps your current tool; Undo again on the strip that appears steps further back. While a sketch tool has a sketch, it takes back that first |
| Redo | R | Bottom left (action) | Makes again what Undo took back, in the same order, and keeps your current tool |
| Sketch line | L | Top (reference) | Pinch and drag to draw a path for the agent, through the drawing aids (say "sketch line" or "path" to pick it). It shows dashed in your hand's colour, labelled S1, S2 and so on, and is not part of the model. Shorter than 300 mm keeps nothing. Up to 8 sketches are kept; a request carries them all and clears them, and Escape with a sketch tool active clears them too. Undo and Redo step through them while a sketch tool is active, and the model's own undo never touches them |
| Sketch area | E | Top right (reference) | Pinch and drag around an area: the outline closes when you let go and shows dashed and lightly filled, labelled like a path. Less than a square metre keeps nothing |
| Lasso select | G | Bottom right (reference) | Pinch and drag a loop around what to select (say "lasso"). It shows dashed while you draw and closes when you let go: everything whose middle is inside it is selected (what is hidden or cut away by the section is left out), the bar says how many, and the tool turns itself off, back to Select. A loop smaller than a fingertip keeps the tool and selects nothing |
| Place marker | K | Right (reference) | Tap to place a lettered marker (the first free letter, A to Z); tap a marker to remove it. Markers are kept with the project and every request tells the agent where they are |

Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y do the same as Undo and Redo. A line is found on screen within 12 pixels of its span, however thin it is drawn, unless a surface stands in front of it, and it is drawn at a width on screen so it can be seen at any zoom.

**What Undo covers.** Undo follows your own edits in the order you made them: a move in HAI's scene, then a turn of a Rhino object, then a delete in Blender go back the other way round, each in its own place. An agent's run is not in this order: it is one undo step in its host, and its run report has its own Undo. A host that opens another file, or goes, takes its steps with it, and Undo goes on to the edit before. A page opened after the edits sends Undo to HAI's scene, as it always did.

Elements that projects already have (walls, slabs, columns, massings, lines and imported models) stay and render as before. Select, Move, Rotate and Delete work on them; nothing makes new ones.

## Groups

A group is elements that hold together. Tapping any member selects all of them, and Move, Delete and Rotate act on all of them as one undo step. A file you import arrives as one group, and several elements you send to an agent become one before the request goes (see [agent.md](agent.md)). "Group this" and "ungroup" do it by voice. Groups do not nest, and an element belongs to one: grouping takes it out of any group it was in. To work on one member, ungroup first.

A group is a system tag, `hai.group`, on each member, so it is saved with the project and undone like any other change.

**The options card.** While Select is active, a card is pinned to the top middle of what is selected, with a line back to it. It says what is selected (a group with its id, how many, or one element and its type), and offers Ungroup or Group, then Move, Rotate, Delete, Hide and Ask agent. Ungroup and Group are one press and one undo step; the elements stay selected. The card follows the camera, stays inside the view, moves aside rather than cover another panel, and goes while another tool is active. A hand presses it like any button, and the model under it cannot be picked through it.

**What a host has selected.** While Select is active and objects of a host are selected, a card of the same kind is pinned to them: what each object is as the host describes it (up to 8, then "and n more"), with its type, layer, its largest quantity (m³, m² or m), material and up to three of its own properties (Rhino's user strings, Revit's parameters). It offers Move, Rotate and Delete, and **Ask about this**: type a request in its field and press Ask (or Enter) to send it to the agent about these objects only. A request you speak while the card is open is limited the same way. The agent is told to change only them and to ask before touching anything else, the tasks it hands out are scoped to them, and what its runs change glows once the team is done, until your next selection.

## Placing points exactly: drawing aids

Move, Measure and the sketch tools put their points through the **drawing aids** in **Settings > Drawing aids**. Each is a switch, and Ortho's angle step (90, 45 or 15 degrees) is chosen on the same page; only Grid is on until you change it, and a change applies to the very next point. The status bar lists the aids that apply to the active tool.

| Aid | What it does |
|---|---|
| Grid | Points land on a 100 mm grid (what the tools always did) |
| Ortho | A sketched path, and Rotate's turn, are **locked** to the angles of their step (90, 45 or 15 degrees from the X axis, 45 by default): they take the nearest one. The notice shows the length and the angle |
| Endpoint | Snaps to the ends of walls, the corners of slabs, the centres of columns, and the corners of massings and imported models |
| Midpoint | Snaps to the middle of a wall or of an edge of a slab, a massing or an imported model |
| Centre | Snaps to the centre of a slab, a massing, an imported model or a column |
| Project | Carries the point onto the nearest edge of the model, so a sketch can start anywhere along a wall |
| Perpendicular | Ends a line where it meets an edge at a right angle |

Snaps work **at every height**: candidates are the real points of the model, at the base and the top of walls and columns, at the top of slabs, and at the bottom and the top of massings and imported models, and the pointer is matched to them where they appear on screen, within 24 pixels, whatever the zoom and however high they are. A wall end three floors up, or the top corner of an imported building, snaps when it is under the pointer on screen, even if it is hidden behind something. A sketch started on a snapped point is drawn in the plane at that height. When more than one could apply, the first of Endpoint, Midpoint, Centre, Perpendicular and Project that is within reach wins, and Grid takes what is left. With Ortho on, only a snap that lies on the held line counts (Project then means where the line meets the edge). The snapped point shows a ring and the aid's name, and the notice repeats it, for example "Path 5000 mm at 0 deg (Endpoint)". Ortho and Perpendicular need a start, so they apply to the end of a path, not to its first point.

A hand always shakes a little, so what a hand has is kept against it: a snap stays until the pointer is 36 pixels from it (it is taken within 24), an Ortho angle stays until the pointer is 4 degrees past the half-way line to the next step, and within 16 pixels of the last point the angle does not change at all. The mouse lands exactly where it points.

Move carries one point of the element (a column's centre, a wall's start, a massing's origin corner, a slab's first corner, an imported model's lowest corner, a host object's lowest box corner) to the snap. With only Grid on it moves by whole 100 mm steps, as before, so the element keeps its own alignment.

## Choosing the layout

**Settings > Tool rings** has a switch between the edit ring and the reference ring, listing its eight slots clockwise from the top. Pick any registered tool for each slot, or leave it empty. **Dominant hand** (Right or Left) decides which hand's silent long pinch shows which ring. The layouts and the dominant hand are saved by the bridge in `.hai/settings.json` in the workspace, so they are the same in every browser and after a restart.

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

A tool can implement any of these; the `ctx` it receives reads and changes the scene (`doc`, `apply`, `undo`, `redo`, `select`), edits a host's objects (`hostTarget`, `hostSelection`, `previewHost`, `applyHost`), looks into the view (`pick`, `ground`, `bounds`), draws on it (`overlay`, `setOverlay`, `flash`), places points with the drawing aids (`aids`, `mmPerPixel`, `resolve`, `clearSnap`) and asks for confirmation (`confirm`).

| Member | When it is called |
|---|---|
| `activate`, `deactivate` | The tool becomes active, or another tool does |
| `onHover(ctx, at)` | The pointer moved (hand or mouse), for hover feedback |
| `onTap(ctx, at, hit)` | A tap or click; `hit` is the element and point under it, or null |
| `onDragStart(ctx, at, hit)` | A drag begins. Return true to take it; otherwise the view orbits |
| `onDrag`, `onDragEnd` | The drag moves and ends |
| `onDragCancel` | The drag was taken over (the palette opened) or the user disengaged: undo any preview, commit nothing |
| `onUndo`, `onRedo` | Undo or Redo while the tool is active: return true if it undid something of its own, otherwise the model's turn comes (`canUndo` and `canRedo` keep the toolbar's buttons right) |
| `canFinish` | Whether a nod or Enter would finish what is drawn; a tool with this gets a Finish button in its panel |
| `modes` | The ways of working the tool has, with a toggle in its panel at the right of the view and spoken names |
| `editsLinePoints` | Line points show as handles while the tool is active |
| `pressPlaces` | Says that a hand's pinch places one thing: the preview stands still as the fingers close, the tool takes the pinch however far the hand drifts, and a long still pinch is given up for talking or a ring |
| `followsHand` | Says which hand is steering what is drawn, so it is followed while the other hand has the focus |
| `instant` and `run(ctx)` | Instant tools (like Undo) run once and leave the current tool active |

Positions (`at`) are viewer coordinates, 0 to 1 across and down the 3D view, whether they come from a hand, the mouse or a test.
