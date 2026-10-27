import { DRAWING_AIDS, type DrawingAidId } from "@hai/protocol";
import { ORTHO_STEPS } from "@hai/scene";
import { type FormEvent, useState, useSyncExternalStore } from "react";
import type { DrawingAidsStore } from "../settings/drawing-aids.ts";
import type { ToolController } from "./controller.ts";

/** The tools whose points are held by constraints: the panel shows while one of them is active. */
const DRAWING_TOOLS = new Set(["line", "wall"]);
/** The point snaps offered as chips, in the order they are tried. */
const SNAP_AIDS: DrawingAidId[] = ["grid", "endpoint", "midpoint", "centre", "project", "perpendicular"];
const aidLabel = (id: DrawingAidId) => DRAWING_AIDS.find((a) => a.id === id)?.label ?? id;

/**
 * Drawing constraints, at the viewport's right while Line or Wall is active: Ortho and the angle step it holds to, a
 * length for the next segment, and the point snaps. Every control is a button a hand can press (the length can also be
 * typed), and every change goes through the same stores as Settings > Drawing aids, so the two never disagree.
 */
export function ConstraintsPanel({
  controller,
  aids,
}: {
  controller: ToolController;
  aids: DrawingAidsStore;
}) {
  const { activeId, constraints } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const on = useSyncExternalStore(aids.subscribe, aids.getSnapshot);
  const [draft, setDraft] = useState("");
  if (!DRAWING_TOOLS.has(activeId)) return null;
  const tool = controller.registry.get(activeId);

  const lock = (e: FormEvent) => {
    e.preventDefault();
    const mm = Number(draft.replace(",", "."));
    if (Number.isFinite(mm) && mm > 0) controller.setLength(mm);
  };
  const free = () => {
    controller.setLength(null);
    setDraft("");
  };

  return (
    <aside
      className="constraints"
      data-testid="constraints"
      data-hud
      aria-label={`${tool?.label ?? "Drawing"} constraints`}
    >
      <header className="constraints-head">{tool?.label} constraints</header>
      <div className="constraints-row">
        <button
          type="button"
          className="constraint-chip"
          data-testid="constraint-ortho"
          data-hand-press
          aria-pressed={on.ortho}
          onClick={() => aids.set("ortho", !on.ortho)}
        >
          Ortho
        </button>
        <div className="constraints-steps" role="radiogroup" aria-label="Ortho angle step">
          {ORTHO_STEPS.map((step) => (
            // biome-ignore lint/a11y/useSemanticElements: a segmented control of buttons, not form radios
            <button
              key={step}
              type="button"
              role="radio"
              aria-checked={constraints.angleStepDeg === step}
              data-testid={`constraint-step-${step}`}
              data-hand-press
              onClick={() => controller.setAngleStep(step)}
            >
              {step}°
            </button>
          ))}
        </div>
      </div>
      <form className="constraints-row" onSubmit={lock}>
        <label className="constraints-label" htmlFor="constraint-length">
          Length
        </label>
        <input
          id="constraint-length"
          data-testid="constraint-length"
          className="constraints-length"
          inputMode="decimal"
          autoComplete="off"
          placeholder="mm"
          value={constraints.lengthMm === null ? draft : String(constraints.lengthMm)}
          readOnly={constraints.lengthMm !== null}
          onChange={(e) => setDraft(e.target.value)}
        />
        {constraints.lengthMm === null ? (
          <button type="submit" className="constraint-chip" data-testid="constraint-lock" data-hand-press>
            Lock
          </button>
        ) : (
          <button
            type="button"
            className="constraint-chip"
            data-testid="constraint-free"
            data-hand-press
            aria-pressed="true"
            onClick={free}
          >
            Free
          </button>
        )}
      </form>
      <div className="constraints-snaps" role="group" aria-label="Point snaps">
        {SNAP_AIDS.map((id) => (
          <button
            key={id}
            type="button"
            className="constraint-chip"
            data-testid={`constraint-aid-${id}`}
            data-hand-press
            aria-pressed={on[id]}
            onClick={() => aids.set(id, !on[id])}
          >
            {aidLabel(id)}
          </button>
        ))}
      </div>
    </aside>
  );
}
