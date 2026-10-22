import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ModelImporter } from "./importer.ts";

const STAGE_TEXT = {
  reading: "Reading the file",
  loading: "Loading the Rhino reader",
  converting: "Converting the geometry",
  saving: "Saving the model with the project",
} as const;

/** The key that opens the file picker from the keyboard (a hand press cannot: browsers want a real click or key). */
export const IMPORT_SHORTCUT = "i";

/**
 * The Import button in the project bar. It opens a file picker for `.3dm` files. Browsers open a file picker only
 * after a real click or key press, which a hand's pinch is not, so a pinch on the button explains that and points to
 * the mouse or Ctrl+I.
 */
export function ImportButton({ importer }: { importer: ModelImporter }) {
  const input = useRef<HTMLInputElement>(null);
  const state = useSyncExternalStore(importer.subscribe, importer.getSnapshot);

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (
        typing ||
        !(e.ctrlKey || e.metaKey) ||
        e.shiftKey ||
        e.altKey ||
        e.key.toLowerCase() !== IMPORT_SHORTCUT
      ) {
        return;
      }
      e.preventDefault();
      input.current?.click();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  return (
    <>
      <button
        type="button"
        className="secondary"
        data-testid="import-button"
        title="Import a Rhino .3dm model (Ctrl+I), or drop the file on the model"
        disabled={state.phase === "working"}
        onClick={() => {
          if (navigator.userActivation && !navigator.userActivation.isActive) {
            importer.reject(
              "",
              "Browsers open the file picker only after a mouse click or a key press. Click Import with the mouse, press Ctrl+I, or drop the .3dm file on the model.",
            );
            return;
          }
          input.current?.click();
        }}
      >
        Import
      </button>
      <input
        ref={input}
        type="file"
        accept=".3dm"
        hidden
        data-testid="import-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // the same file can be chosen again
          if (file) void importer.importFile(file);
        }}
      />
    </>
  );
}

/** Whether a drag carries files (not text or a link). */
const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes("Files") ?? false;

/**
 * A `.3dm` file dropped anywhere on the page is imported, and the browser never opens or downloads it. While a file
 * is over the page a message says where it goes.
 */
export function ImportDropZone({ importer }: { importer: ModelImporter }) {
  const [over, setOver] = useState(false);

  useEffect(() => {
    let depth = 0; // dragenter and dragleave fire for every child element on the way
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const move = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // allows the drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const file = e.dataTransfer?.files[0];
      if (file) void importer.importFile(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", move);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", move);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [importer]);

  if (!over) return null;
  return (
    <div className="import-drop" data-testid="import-drop" aria-hidden="true">
      <p>Drop a .3dm file to import it</p>
    </div>
  );
}

/** What the import is doing, and afterwards what it brought in and what it left out. */
export function ImportReport({ importer }: { importer: ModelImporter }) {
  const state = useSyncExternalStore(importer.subscribe, importer.getSnapshot);
  if (state.phase === "idle") return null;
  const working = state.phase === "working";
  return (
    <div
      className="import-report"
      data-testid="import-report"
      data-phase={state.phase}
      role="status"
      aria-live="polite"
      data-hud
    >
      {state.file && <strong>{state.file}</strong>}
      {state.phase === "working" && <p>{STAGE_TEXT[state.stage]}...</p>}
      {state.phase === "done" && <p data-testid="import-summary">{state.summary}</p>}
      {state.phase === "failed" && (
        <p data-testid="import-error" className="import-error">
          {state.message}
        </p>
      )}
      {!working && (
        <button
          type="button"
          className="secondary"
          data-testid="import-close"
          data-hand-press
          onClick={() => importer.dismiss()}
        >
          Close
        </button>
      )}
    </div>
  );
}
