import { useEffect, useState } from "react";
import { browserDeps, type ConnectionState, connectToBridge } from "./bridge/connection.ts";
import { TrackingPanel } from "./perception/TrackingPanel.tsx";
import type { TrackerState } from "./perception/tracker.ts";

const LABELS: Record<ConnectionState["status"], { text: string; hint?: string }> = {
  "no-session": { text: "Bridge not started", hint: "Run pnpm dev from the repository root, then reload." },
  connecting: { text: "Connecting" },
  connected: { text: "Connected" },
  offline: { text: "Bridge offline", hint: "Retrying. Is pnpm dev still running?" },
  refused: { text: "Bridge refused", hint: "The bridge restarted with a new session. Reload the page." },
};

export function App() {
  const [bridge, setBridge] = useState<ConnectionState>({ status: "connecting" });
  const [camera, setCamera] = useState<TrackerState>({ camera: "off" });

  useEffect(() => connectToBridge(window.__AEX_SESSION__ ?? null, browserDeps, setBridge), []);

  const label = LABELS[bridge.status];
  const cameraOn = camera.camera === "on" || camera.camera === "starting";
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="wordmark">AEX</span>
          <span className="tagline">hands, face and voice for AEC agents</span>
        </div>
        <div className="pills">
          <output
            className="status camera"
            data-testid="camera-indicator"
            data-state={cameraOn ? "on" : "off"}
            aria-live="polite"
          >
            <span className="dot" aria-hidden="true" />
            <span>{cameraOn ? "Camera on" : "Camera off"}</span>
          </output>
          <output
            className="status"
            data-testid="bridge-status"
            data-state={bridge.status}
            aria-live="polite"
          >
            <span className="dot" aria-hidden="true" />
            <span>{label.text}</span>
            {bridge.status === "connected" && (
              <span className="meta">
                v{bridge.bridgeVersion} / {bridge.clients} {bridge.clients === 1 ? "client" : "clients"}
              </span>
            )}
          </output>
        </div>
      </header>
      <main className="stage">
        {label.hint && <p className="hint">{label.hint}</p>}
        <TrackingPanel onCameraState={setCamera} />
      </main>
    </div>
  );
}
