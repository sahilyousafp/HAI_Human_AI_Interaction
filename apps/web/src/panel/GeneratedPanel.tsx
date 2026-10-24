import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FRAME_CSP, FRAME_SANDBOX, frameDocument, readTheme } from "./frame-document.ts";
import type { PanelClient, PanelScene, PanelView } from "./panel-client.ts";
import { PANEL_LOAD_TIMEOUT_MS, PanelHost } from "./panel-host.ts";
import { clampToWindow } from "./panel-position.ts";

/** Where a panel first appears: beside the model's left column, under the top bar. */
const START = { x: 428, y: 76 };
const DEFAULT_SIZE = { width: 320, height: 240 };

declare global {
  interface Window {
    /** Dev builds only: the open panel's frame handle, for end-to-end tests. */
    __HAI_PANEL__?: { host(): PanelHost | null };
  }
}

/**
 * The sandboxed frame. It is built by hand rather than rendered, so the sandbox, the policy and the document are all
 * in place before it first loads: React could set them in any order. The frame is told its one MessagePort when it
 * has loaded; a second load means the document navigated itself away, which ends it.
 */
function PanelFrame({
  panel,
  client,
  scene,
  onHost,
}: {
  panel: PanelView;
  client: PanelClient;
  scene: PanelScene;
  onHost: (host: PanelHost | null) => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const document_ = panel.document;
  const panelId = panel.panelId;
  const revision = panel.revision;
  const html = document_?.html;
  const { width, height } = document_ ?? DEFAULT_SIZE;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new frame for each document (panel and revision)
  useEffect(() => {
    const container = slot.current;
    if (!container || !panelId || html === undefined) return;
    const frame = window.document.createElement("iframe");
    frame.setAttribute("sandbox", FRAME_SANDBOX);
    frame.setAttribute("csp", FRAME_CSP);
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("title", "Generated panel");
    frame.setAttribute("data-testid", "panel-frame");
    frame.setAttribute("data-hand-press", "");
    frame.srcdoc = frameDocument(html, readTheme());
    let host: PanelHost | null = null;
    let loads = 0;
    const adopt = (next: PanelHost | null) => {
      host = next;
      onHost(next);
      client.setFrame(next ? { element: frame, press: (phase, x, y) => next.press(phase, x, y) } : null);
    };
    // A document that never finishes loading (a script that spins) never fires `load`: it is ended all the same.
    const stuck = setTimeout(() => {
      host?.dispose();
      frame.srcdoc = "";
      frame.remove();
      client.loaded(panelId, false, "The panel did not finish loading.");
    }, PANEL_LOAD_TIMEOUT_MS);
    frame.addEventListener("load", () => {
      if (loads === 0) clearTimeout(stuck);
      loads += 1;
      if (loads > 1) {
        // The document sent itself somewhere else. Nothing of it stays.
        adopt(null);
        host?.dispose();
        frame.srcdoc = "";
        frame.remove();
        client.failed(panelId, "The panel tried to navigate away and was stopped.");
        return;
      }
      const channel = new MessageChannel();
      const next = new PanelHost({ port: channel.port1, panelId, client, scene });
      next.setTheme(readTheme());
      adopt(next);
      // The frame's origin is opaque, so there is no origin to name; only this frame's window gets the port.
      frame.contentWindow?.postMessage({ hai: "port" }, "*", [channel.port2]);
    });
    container.append(frame);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const restyle = () => host?.setTheme(readTheme());
    scheme.addEventListener("change", restyle);
    return () => {
      clearTimeout(stuck);
      scheme.removeEventListener("change", restyle);
      host?.dispose();
      adopt(null);
      frame.remove();
    };
  }, [client, scene, panelId, revision]);

  return (
    <div
      ref={slot}
      className="panel-frame"
      data-testid="panel-frame-slot"
      style={{ width, height }}
      data-status={panel.status}
    />
  );
}

/** The panel's header, body and footer. Its own controls are outside the frame, so the document cannot touch them. */
function PanelShell({ panel, client, scene }: { panel: PanelView; client: PanelClient; scene: PanelScene }) {
  const [at, setAt] = useState(START);
  const host = useRef<PanelHost | null>(null);
  const size = panel.document ?? DEFAULT_SIZE;
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const shell = useRef<HTMLElement>(null);

  // Stay in the window when it, or the panel, changes size.
  useEffect(() => {
    const keep = () =>
      setAt((p) => clampToWindow(p, size, { width: window.innerWidth, height: window.innerHeight }));
    keep();
    window.addEventListener("resize", keep);
    return () => window.removeEventListener("resize", keep);
  }, [size]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__HAI_PANEL__ = { host: () => host.current };
    return () => {
      window.__HAI_PANEL__ = undefined;
    };
  }, []);

  const onDown = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - at.x, dy: e.clientY - at.y };
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const next = { x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy };
    setAt(clampToWindow(next, size, { width: window.innerWidth, height: window.innerHeight }));
  };
  const onUp = () => {
    drag.current = null;
  };

  const loading = panel.status === "loading";
  const failed = panel.status === "failed";
  const title = panel.document?.title ?? "Preparing your panel";
  return (
    <section
      ref={shell}
      className="generated-panel"
      data-testid="generated-panel"
      data-status={panel.status}
      data-hud
      aria-label={title}
      style={{ left: at.x, top: at.y, width: size.width }}
      onKeyDown={(e) => {
        if (e.key === "Escape") client.close();
      }}
    >
      <header
        className="panel-head"
        data-testid="panel-header"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <span className="panel-grip" aria-hidden="true" />
        <strong className="panel-title" data-testid="panel-title">
          {title}
        </strong>
        {failed && (
          <span className="panel-badge" data-testid="panel-failed" role="alert">
            Failed
          </span>
        )}
      </header>
      {failed && panel.reason && (
        <p className="panel-reason" data-testid="panel-reason">
          {panel.reason}
        </p>
      )}
      <div className="panel-body" style={{ height: size.height }}>
        {panel.panelId && (
          <PanelFrame
            panel={panel}
            client={client}
            scene={scene}
            onHost={(next) => {
              host.current = next;
            }}
          />
        )}
        {loading && (
          <div className="panel-loading" data-testid="panel-loading" role="status">
            <span className="panel-spinner" aria-hidden="true" />
            <span>{panel.document ? "Loading" : "Your agent is writing the panel"}</span>
          </div>
        )}
      </div>
      <footer className="panel-foot">
        <button
          type="button"
          className="secondary"
          data-testid="panel-close"
          data-hand-press
          title="Close and put the model back (Escape)"
          onClick={() => client.close()}
        >
          Close
        </button>
        <button
          type="button"
          className="primary"
          data-testid="panel-done"
          data-hand-press
          disabled={!panel.panelId}
          title="Keep the result as one undo step and close"
          onClick={() => client.done()}
        >
          Done
        </button>
      </footer>
    </section>
  );
}

/** The one generated panel, floating over the model while it is open. */
export function GeneratedPanel({ client, scene }: { client: PanelClient; scene: PanelScene }) {
  const { panel } = useSyncExternalStore(client.subscribe, client.getSnapshot);
  if (!panel) return null;
  return <PanelShell panel={panel} client={client} scene={scene} />;
}
