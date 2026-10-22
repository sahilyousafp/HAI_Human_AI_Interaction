import { useSyncExternalStore } from "react";
import type { ProjectExporter } from "./exporter.ts";

/** Save as 3dm in the project bar: builds a Rhino file from the open project and offers it as a download. */
export function SaveAs3dmButton({ exporter }: { exporter: ProjectExporter }) {
  const state = useSyncExternalStore(exporter.subscribe, exporter.getSnapshot);
  return (
    <button
      type="button"
      className="secondary"
      data-testid="save-3dm"
      title="Save the project as a Rhino .3dm file"
      disabled={state.phase === "working"}
      onClick={() => void exporter.save()}
    >
      Save as 3dm
    </button>
  );
}

const STAGE_TEXT = { gathering: "Gathering the imported models", writing: "Writing the Rhino file" } as const;

/** What saving is doing, and afterwards what it saved and what it left out. */
export function ExportReport({ exporter }: { exporter: ProjectExporter }) {
  const state = useSyncExternalStore(exporter.subscribe, exporter.getSnapshot);
  if (state.phase === "idle") return null;
  return (
    <div
      className="import-report"
      data-testid="export-report"
      data-phase={state.phase}
      role="status"
      aria-live="polite"
      data-hud
    >
      {state.phase === "done" && <strong>{state.file}</strong>}
      {state.phase === "working" && <p>{STAGE_TEXT[state.stage]}...</p>}
      {state.phase === "done" && <p data-testid="export-summary">{state.summary}</p>}
      {state.phase === "failed" && (
        <p data-testid="export-error" className="import-error">
          {state.message}
        </p>
      )}
      {state.phase !== "working" && (
        <button
          type="button"
          className="secondary"
          data-testid="export-close"
          data-hand-press
          onClick={() => exporter.dismiss()}
        >
          Close
        </button>
      )}
    </div>
  );
}
