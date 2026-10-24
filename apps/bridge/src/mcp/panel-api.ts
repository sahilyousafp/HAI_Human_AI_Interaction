import { PANEL_MAX_BYTES, PANEL_MAX_MESSAGES_PER_SECOND } from "@hai/protocol";

/** The controls a hand can press inside a panel (a pinch over them), and the ones it cannot. */
export const PANEL_HAND_CONTROLS = ["button", "checkbox", "radio", "range"] as const;

/**
 * What the agent is told about panels: the offer flow, the `hai` object a panel's script sees, the base styles and
 * the hand-input rules. It travels with the bridge, so it is always the version the app runs; the agents' own files
 * do not need to mention panels.
 */
export function openPanelDescription(elementShapes: string): string {
  return `Puts a small panel on the user's screen, written by you for this task, after the user accepted your offer_panel. Without an accepted offer this is refused. Returns "ready" once the page loaded your document, or the error if it did not (then fix it with update_panel). The call returns at once; the user keeps the panel open as long as they like, and you are told when it closes and whether they kept the result.

You write ONE self-contained HTML document (at most ${PANEL_MAX_BYTES / 1024} KB) with a title and a size in pixels (width 200-720, height 120-720; default 320 x 240). Keep it small: a few labelled controls with units, and a readout. Show the tolerance state in the panel itself (for example turn the readout red outside the range). The panel runs in a sandbox: no network, no external scripts, fonts or images (use data: URIs), no storage, no windows, and no access to your tools or to the app. Use inline <script> and <style> only.

THE hai OBJECT (the only way out of the panel):
- hai.scene.get({ ids?, type?, level? }) -> Promise<{ elements, notFound? }>: the committed scene with your own preview applied, at most 200 elements. Same element shapes as get_elements.
- hai.selection -> the ids of the selected elements right now.
- hai.on("scene" | "selection" | "theme" | "problem", callback): "scene" means the scene changed (read it again); "selection" gets the new ids; "theme" gets "light" or "dark" (colours already follow it); "problem" gets a message when an operation was rejected (it names the element and field), a preview no longer applied, or messages were dropped.
- hai.preview(ops): replaces the panel's current preview with these scene operations ([] clears it). The user sees the model change as the control moves, before anything is saved: no undo step, and you do not see it either. Operations are the ones create_elements, update_elements and delete_elements use: { op: "create", element } | { op: "update", id, patch } | { op: "delete", id }. Invalid operations change nothing. Send previews on the "input" event of a range control; at most ${PANEL_MAX_MESSAGES_PER_SECOND} messages per second are accepted.
- hai.commit(): keeps the current preview as ONE undo step and leaves the panel open (for an "Apply" button). The frame around your panel has Done (commit and close) and Close (discard); you cannot draw or hide those, and you do not need to.

${elementShapes}

STYLES: the HUD's theme is already applied. Plain <label>, <input type="range|number|checkbox|radio">, <button>, <output>, <table> and <h2>/<p> are styled and sized for use by hand. Colour variables you can use (the HUD's own): --panel (background), --ink (text), --muted, --line, --fill, --accent, --ok, --warn, --risk.

HAND INPUT: the user may drive the panel by hand (a pinch over a control). Controls that work by hand: ${PANEL_HAND_CONTROLS.join(", ")}. A hand cannot use <select>, text fields or text selection, so use buttons or a range instead, and keep targets large. The mouse and keyboard work on everything.

EXAMPLE (a clearance between a column and a wall, slider in millimetres):
<h2>Column clearance</h2>
<label>Clearance <output id="v">150</output> mm</label>
<input id="s" type="range" min="50" max="400" step="5" value="150">
<p id="state"></p>
<button id="apply">Apply</button>
<script>
  const slider = document.getElementById("s"), v = document.getElementById("v"), state = document.getElementById("state");
  let base;
  hai.scene.get({ ids: ["column-1"] }).then(({ elements }) => { base = elements[0]; move(); });
  function move() {
    if (!base) return;
    const gap = Number(slider.value);
    v.textContent = gap;
    state.textContent = gap >= 100 && gap <= 300 ? "Within tolerance" : "Outside 100-300 mm";
    state.style.color = gap >= 100 && gap <= 300 ? "" : "var(--risk)";
    hai.preview([{ op: "update", id: base.id, patch: { position: [base.position[0] + gap - 150, base.position[1]] } }]);
  }
  slider.addEventListener("input", move);
  document.getElementById("apply").addEventListener("click", () => hai.commit());
</script>`;
}
