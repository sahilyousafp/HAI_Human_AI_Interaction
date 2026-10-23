import { type ReactNode, useEffect, useRef, useState } from "react";
import { ToolIcon } from "../tools/ToolOverlays.tsx";
import { ListGroup, ListRow } from "../ui/controls.tsx";

/** One page of the settings: a row on the first page that opens it. */
export interface SettingsSection {
  id: string;
  title: string;
  /** SVG path data for the row's 24 x 24 icon. */
  icon: string;
  /** The icon tile's colour (a CSS colour token). */
  tint: string;
  /** A short value shown at the end of the row ("On", "3 changed"). */
  detail?: string;
  render(): ReactNode;
}

const CLOSE_ICON = "M6 6l12 12M18 6 6 18";
const PAGE_KEY = "hai.settingsPage";

function readPage(): string | null {
  try {
    return localStorage.getItem(PAGE_KEY);
  } catch {
    return null;
  }
}

function writePage(id: string | null): void {
  try {
    if (id) localStorage.setItem(PAGE_KEY, id);
    else localStorage.removeItem(PAGE_KEY);
  } catch {
    // Storage blocked (private window): the page is remembered for this visit only.
  }
}

/**
 * The settings, as a sheet that slides in from the right over the model: a first page listing the sections (each
 * opens its own page, with a back button, as in the iOS Settings app) and quick switches at the top. Hands can
 * press and scroll everything in it. Escape or the close button closes it; the last page is remembered.
 */
export function SettingsPanel({
  open,
  onClose,
  quick,
  sections,
  request,
}: {
  open: boolean;
  onClose(): void;
  /** Asks for a page to be shown: a new `seq` shows `page` (the top bar's update pill opens Setup this way). */
  request?: { page: string; seq: number } | null;
  /** Switches shown at the top of the first page. */
  quick: ReactNode;
  sections: SettingsSection[];
}) {
  const [pageId, setPageId] = useState<string | null>(readPage);
  const page = sections.find((s) => s.id === pageId) ?? null;
  const body = useRef<HTMLDivElement>(null);
  const go = (id: string | null) => {
    setPageId(id);
    writePage(id);
    body.current?.scrollTo({ top: 0 });
  };

  const requestedSeq = request?.seq;
  const requestedPage = request?.page;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per request; `go` only sets state.
  useEffect(() => {
    if (requestedSeq !== undefined && requestedPage) go(requestedPage);
  }, [requestedSeq, requestedPage]);

  useEffect(() => {
    if (!open) return;
    const keydown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [open, onClose]);

  return (
    <aside
      className="settings-panel"
      data-testid="settings-panel"
      data-open={open}
      data-hud
      aria-label="Settings"
      aria-hidden={!open}
      inert={!open}
    >
      <header className="settings-head">
        {page ? (
          <button
            type="button"
            className="settings-back"
            data-testid="settings-back"
            onClick={() => go(null)}
          >
            <svg
              aria-hidden="true"
              width="10"
              height="17"
              viewBox="0 0 10 17"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <path d="M8.5 1.5 1.5 8.5l7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Settings
          </button>
        ) : (
          <span />
        )}
        <h2 className="settings-title">{page ? page.title : "Settings"}</h2>
        <button
          type="button"
          className="settings-close"
          data-testid="settings-close"
          aria-label="Close the settings (Escape)"
          onClick={onClose}
        >
          <ToolIcon path={CLOSE_ICON} size={14} />
        </button>
      </header>
      <div ref={body} className="settings-body">
        {page ? (
          <div className="settings-page" data-testid={`settings-page-${page.id}`}>
            {page.render()}
          </div>
        ) : (
          <div className="settings-page" data-testid="settings-root">
            {quick}
            <ListGroup>
              {sections.map((section) => (
                <ListRow
                  key={section.id}
                  testId={`settings-open-${section.id}`}
                  onOpen={() => go(section.id)}
                  label={
                    <span className="settings-row-label">
                      <span className="settings-icon" style={{ background: section.tint }} aria-hidden="true">
                        <ToolIcon path={section.icon} size={15} />
                      </span>
                      {section.title}
                    </span>
                  }
                  control={section.detail}
                />
              ))}
            </ListGroup>
          </div>
        )}
      </div>
    </aside>
  );
}
