import type { Hand } from "@hai/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { SceneClient } from "../scene/scene-client.ts";
import { ListGroup, ListRow, Segmented } from "../ui/controls.tsx";
import { redoTool, undoTool } from "./builtin.ts";
import type { Ring, ToolController } from "./controller.ts";
import { SLOT_COUNT, SLOT_NAMES } from "./palette.ts";
import { spokenNames } from "./registry.ts";

/** An x, for the controls that close or remove something. */
const CLOSE_ICON = "M6 6l12 12M18 6 6 18";
/** Distance from the palette centre to each slot, px. */
const RING_RADIUS = 92;

export function ToolIcon({ path, size = 22 }: { path: string; size?: number }) {
  return (
    <svg
      className="tool-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/** What each ring is called on screen. */
export const RING_NAMES: Record<Ring, string> = { action: "Action ring", reference: "Reference ring" };

/** The radial palette: 8 slots around where it was opened, the highlighted one filled. */
export function Palette({ controller }: { controller: ToolController }) {
  const { palette, layouts } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!palette || palette.hidden) return null;
  const layout = layouts[palette.ring];
  const highlightedId = palette.highlighted === null ? null : layout[palette.highlighted];
  const highlightedLabel = highlightedId ? controller.registry.get(highlightedId)?.label : undefined;
  return (
    <div
      className="tool-palette"
      data-testid="tool-palette"
      data-ring={palette.ring}
      data-hand={palette.hand?.toLowerCase() ?? ""}
      style={{ left: `${palette.center[0] * 100}%`, top: `${palette.center[1] * 100}%` }}
    >
      <span className="visually-hidden" role="status">
        {RING_NAMES[palette.ring]} open:{" "}
        {highlightedLabel ?? "move toward a tool and release, or release in the centre to cancel"}
      </span>
      <span className="palette-centre" aria-hidden="true" />
      {Array.from({ length: SLOT_COUNT }, (_, slot) => {
        const id = layout[slot];
        const tool = id && controller.registry.isAvailable(id) ? controller.registry.get(id) : undefined;
        const angle = (slot * 2 * Math.PI) / SLOT_COUNT;
        const style = {
          transform: `translate(${Math.sin(angle) * RING_RADIUS}px, ${-Math.cos(angle) * RING_RADIUS}px)`,
        };
        const highlighted = palette.highlighted === slot;
        return (
          <div
            key={SLOT_NAMES[slot]}
            className="palette-slot"
            data-testid={`palette-slot-${slot}`}
            data-tool={tool?.id ?? ""}
            data-highlighted={highlighted}
            style={style}
          >
            {tool ? (
              <>
                <ToolIcon path={tool.icon} />
                <span className="palette-label" title={tool.label}>
                  {spokenNames(tool)[0]}
                </span>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The loop being drawn by Lasso select, over the whole view: dashed, closing back on its start. */
export function LassoOutline({ controller }: { controller: ToolController }) {
  const { overlay } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const loop = overlay.lasso;
  if (!loop || loop.length < 2) return null;
  const points = loop.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <svg
      className="lasso-outline"
      data-testid="lasso-outline"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={points} />
    </svg>
  );
}

/** The section's height with its clear control, which a hand can press as well as the mouse. */
export function SectionStatus({ controller }: { controller: ToolController }) {
  const { overlay } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (overlay.sectionMm === null) return null;
  return (
    <div className="section-status" data-testid="section-status">
      <span>Section at {overlay.sectionMm} mm</span>
      <button
        type="button"
        className="secondary"
        data-testid="section-clear"
        data-hand-press
        aria-label="Remove the section"
        onClick={() => controller.clearSection()}
      >
        <ToolIcon path={CLOSE_ICON} size={13} /> Remove
      </button>
    </div>
  );
}

/**
 * What tools say to the user, under the project bar: the current instruction or message, and the yes-or-no question for
 * a deletion. The section readout is `SectionStatus`, beside the status bar.
 */
export function ToolMessages({ controller }: { controller: ToolController }) {
  const { overlay, question } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <div className="tool-messages" aria-live="polite">
      {question ? (
        <div className="tool-question" data-testid="tool-question" role="alertdialog" aria-label="Confirm">
          <span>{question}</span>
          <div className="tool-question-actions">
            <button type="button" className="danger" data-hand-press onClick={() => controller.respond(true)}>
              Delete <kbd>Enter</kbd>
            </button>
            <button
              type="button"
              className="secondary"
              data-hand-press
              onClick={() => controller.respond(false)}
            >
              Keep <kbd>Esc</kbd>
            </button>
          </div>
        </div>
      ) : overlay.notice ? (
        <p className="tool-notice" data-testid="tool-notice">
          {overlay.notice}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The active tool, always visible in the viewer's status bar, with a cancel button back to Select that a hand can
 * press as well as the mouse (Escape and a head shake do the same).
 */
export function ActiveTool({ controller }: { controller: ToolController }) {
  const { activeId } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const tool = controller.registry.get(activeId);
  if (!tool) return null;
  return (
    <span className="active-tool" data-testid="active-tool" data-tool={tool.id}>
      <ToolIcon path={tool.icon} size={15} />
      {tool.label}
      <kbd>{tool.shortcut.toUpperCase()}</kbd>
      {tool.id !== "select" && (
        <button
          type="button"
          className="tool-cancel"
          data-testid="tool-cancel"
          data-hand-press
          aria-label="Back to Select (Escape)"
          title="Back to Select (Escape, or shake your head)"
          onClick={() => controller.cancel()}
        >
          <ToolIcon path={CLOSE_ICON} size={13} />
        </button>
      )}
    </span>
  );
}

/** How long the undo strip stays after an undo or redo. */
const UNDO_STRIP_MS = 6000;

/**
 * After an undo or redo: what was undone, with Undo again and Redo buttons that hands can press, so stepping back
 * several changes is a few taps instead of reopening the palette each time.
 */
export function UndoStrip({ client }: { client: SceneClient }) {
  const { lastChange, canUndo, canRedo } = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [visible, setVisible] = useState(false);
  const recent = lastChange && lastChange.kind !== "apply" ? lastChange : null;
  useEffect(() => {
    if (!recent) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const id = setTimeout(() => setVisible(false), UNDO_STRIP_MS);
    return () => clearTimeout(id);
  }, [recent]);
  if (!visible || !recent) return null;
  return (
    <div className="undo-strip" data-testid="undo-strip" role="status">
      <span>
        {recent.kind === "undo" ? "Undid" : "Redid"} {recent.label}
      </span>
      <button
        type="button"
        className="secondary"
        data-testid="undo-again"
        data-hand-press
        disabled={!canUndo}
        onClick={() => client.undo()}
      >
        <ToolIcon path={undoTool.icon} size={14} /> Undo again
      </button>
      <button
        type="button"
        className="secondary"
        data-testid="redo-again"
        data-hand-press
        disabled={!canRedo}
        onClick={() => client.redo()}
      >
        <ToolIcon path={redoTool.icon} size={14} /> Redo
      </button>
    </div>
  );
}

/** How each ring opens, for its settings tab: by the hand whose silent long pinch shows it, the keys and the mouse. */
function ringHow(ring: Ring, dominant: Hand): string {
  const hand = (ring === "action") === (dominant === "Right") ? "right" : "left";
  return ring === "action"
    ? `a silent long pinch of your ${hand} hand, Space or hold right-click`
    : `a silent long pinch of your ${hand} hand, Shift+Space or Shift and hold right-click`;
}

/**
 * Which tools sit in which slot of each ring, one tab per ring; available tools include any registered at
 * runtime.
 */
export function PaletteSettings({ controller }: { controller: ToolController }) {
  const { layouts, dominantHand } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [ring, setRing] = useState<Ring>("action");
  const layout = layouts[ring];
  const tools = controller.registry.list();
  return (
    <section className="palette-settings" aria-label="Tool palette">
      <ListGroup>
        <ListRow
          label="Dominant hand"
          detail="The hand you draw with: its silent long pinch shows the action ring, the other hand's the reference ring."
          control={
            <Segmented<Hand>
              label="Dominant hand"
              testId="dominant-hand"
              value={dominantHand}
              onChange={(hand) => controller.setDominantHand(hand)}
              options={[
                { value: "Right", label: "Right", testId: "dominant-hand-right" },
                { value: "Left", label: "Left", testId: "dominant-hand-left" },
              ]}
            />
          }
        />
      </ListGroup>
      <Segmented<Ring>
        label="Ring"
        value={ring}
        onChange={setRing}
        options={[
          { value: "action", label: RING_NAMES.action, testId: "ring-tab-action" },
          { value: "reference", label: RING_NAMES.reference, testId: "ring-tab-reference" },
        ]}
      />
      <p className="muted ring-how">Opens with {ringHow(ring, dominantHand)}.</p>
      <div className="palette-settings-grid">
        {SLOT_NAMES.map((name, slot) => (
          <label key={name} className="field">
            <span>{name}</span>
            <select
              data-testid={`palette-setting-${slot}`}
              value={layout[slot] ?? ""}
              onChange={(e) => {
                const next = [...layout];
                next[slot] = e.target.value || null;
                controller.setLayout(next, ring);
              }}
            >
              <option value="">Empty</option>
              {tools.map((tool) => (
                <option key={tool.id} value={tool.id}>
                  {tool.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}
