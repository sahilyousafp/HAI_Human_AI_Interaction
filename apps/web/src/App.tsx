import type { Message } from "@aex/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgentPanel, AgentPermissions } from "./agent/AgentPanel.tsx";
import { AgentClient } from "./agent/agent-client.ts";
import { ViewLink } from "./agent/view-link.ts";
import {
  type BridgeConnection,
  browserDeps,
  type ConnectionState,
  connectToBridge,
} from "./bridge/connection.ts";
import { GestureSettingsCard } from "./input/GestureSettingsCard.tsx";
import { GestureSettings } from "./input/gesture-settings.ts";
import { InputBus } from "./input/input-bus.ts";
import { TrackingPanel } from "./perception/TrackingPanel.tsx";
import type { TrackerState } from "./perception/tracker.ts";
import { SceneClient } from "./scene/scene-client.ts";
import { DEFAULT_LAYOUT, registerBuiltinTools } from "./tools/builtin.ts";
import { ToolController } from "./tools/controller.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { PaletteSettings } from "./tools/ToolOverlays.tsx";
import { LatencyTracker } from "./viewer/latency.ts";
import { Viewer } from "./viewer/Viewer.tsx";

declare global {
  interface Window {
    __AEX_SCENE__?: SceneClient;
  }
}

const LABELS: Record<ConnectionState["status"], { text: string; hint?: string }> = {
  "no-session": { text: "Bridge not started", hint: "Run pnpm dev from the repository root, then reload." },
  connecting: { text: "Connecting" },
  connected: { text: "Connected" },
  offline: {
    text: "Bridge offline",
    hint: "Retrying. Hand navigation keeps working; edits wait for the bridge.",
  },
  refused: { text: "Bridge refused", hint: "The bridge restarted with a new session. Reload the page." },
};

export function App() {
  const [bridge, setBridge] = useState<ConnectionState>({ status: "connecting" });
  const [camera, setCamera] = useState<TrackerState>({ camera: "off" });
  const connection = useRef<BridgeConnection | null>(null);
  const sceneClient = useMemo(
    () => new SceneClient((message: Message) => connection.current?.send(message) ?? false),
    [],
  );
  const agent = useMemo(
    () => new AgentClient((message: Message) => connection.current?.send(message) ?? false),
    [],
  );
  const viewLink = useMemo(
    () => new ViewLink((message: Message) => connection.current?.send(message) ?? false),
    [],
  );
  const bus = useMemo(() => new InputBus(), []);
  const renderLatency = useMemo(() => new LatencyTracker(), []);
  const tools = useMemo(() => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const controller = new ToolController(registry, DEFAULT_LAYOUT);
    // The layout is a user setting kept by the bridge, so it follows the workspace across browsers and restarts.
    controller.onLayoutChange = (palette) =>
      connection.current?.send({ type: "settings.set", id: crypto.randomUUID(), payload: { palette } });
    return controller;
  }, []);
  // What each gesture does is a user setting kept by the bridge too.
  const gestureSettings = useMemo(
    () =>
      new GestureSettings(
        (gestures) =>
          connection.current?.send({
            type: "settings.set",
            id: crypto.randomUUID(),
            payload: { gestures },
          }) ?? false,
      ),
    [],
  );
  const gestures = useMemo(
    () => ({
      bindings: gestureSettings.getSnapshot,
      agent: {
        answer: (yes: boolean) => agent.answer(yes, bus.engaged),
        stop: () => agent.stopRunning(),
        ask: () => tools.choose("ask-agent"),
      },
    }),
    [gestureSettings, agent, bus, tools],
  );

  // Dev builds only: lets end-to-end tests edit the scene through the same client the UI uses.
  useEffect(() => {
    if (import.meta.env.DEV) window.__AEX_SCENE__ = sceneClient;
  }, [sceneClient]);

  useEffect(() => {
    const conn = connectToBridge(window.__AEX_SESSION__ ?? null, browserDeps, setBridge, (message) => {
      if (viewLink.handle(message) || agent.handle(message) || sceneClient.handle(message)) return;
      if (message.type === "settings.snapshot") {
        tools.loadLayout(message.payload.palette ?? DEFAULT_LAYOUT);
        gestureSettings.load(message.payload.gestures);
      }
    });
    connection.current = conn;
    return () => {
      conn.close();
      viewLink.dispose();
    };
  }, [sceneClient, tools, viewLink, agent, gestureSettings]);

  const askAgent = () => {
    if (bridge.status !== "connected") return "The agent is not connected: the bridge is offline.";
    const status = agent.getSnapshot().status;
    if (status?.state === "unavailable") return `The agent is not available. ${status.reason}`;
    agent.requestFocus();
    return null;
  };

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
      <main className="workspace">
        <div className="stage">
          <Viewer
            client={sceneClient}
            bus={bus}
            latency={renderLatency}
            tools={tools}
            view={viewLink}
            askAgent={askAgent}
            gestures={gestures}
          >
            <AgentPanel client={agent} />
          </Viewer>
          {label.hint && <p className="hint">{label.hint}</p>}
        </div>
        <aside className="sidebar" aria-label="Tracking">
          <TrackingPanel onCameraState={setCamera} bus={bus} renderLatency={renderLatency} />
          <GestureSettingsCard settings={gestureSettings} bus={bus} />
          <PaletteSettings controller={tools} />
          <AgentPermissions client={agent} />
        </aside>
      </main>
    </div>
  );
}
