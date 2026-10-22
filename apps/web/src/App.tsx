import type { FeatureId, Message, MessageOf, ReplyVoice, SpeechMode } from "@aex/protocol";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AgentPanel, AgentPermissions } from "./agent/AgentPanel.tsx";
import { addressOf } from "./agent/addressing.ts";
import { AgentClient } from "./agent/agent-client.ts";
import { ViewLink } from "./agent/view-link.ts";
import {
  type BridgeConnection,
  browserDeps,
  type ConnectionState,
  connectToBridge,
} from "./bridge/connection.ts";
import { ProjectExporter } from "./export/exporter.ts";
import { buildInWorker } from "./export/rhino-client.ts";
import { ModelImporter } from "./import/importer.ts";
import { assetUrl, ModelAssets } from "./import/model-assets.ts";
import { convertInWorker } from "./import/rhino-client.ts";
import { GestureSettingsCard } from "./input/GestureSettingsCard.tsx";
import { GestureSettings } from "./input/gesture-settings.ts";
import { InputBus } from "./input/input-bus.ts";
import { CameraSettings } from "./perception/CameraSettings.tsx";
import { CameraView } from "./perception/CameraView.tsx";
import { HandOverlay } from "./perception/HandOverlay.tsx";
import { TrackingSession } from "./perception/tracking-session.ts";
import { SceneClient } from "./scene/scene-client.ts";
import { DrawingAidsSettings } from "./settings/DrawingAidsSettings.tsx";
import { DrawingAidsStore } from "./settings/drawing-aids.ts";
import { FeatureSettings } from "./settings/FeatureSettings.tsx";
import { FeatureFlags } from "./settings/feature-flags.ts";
import { SettingsPanel, type SettingsSection } from "./settings/SettingsPanel.tsx";
import { DEFAULT_LAYOUT, registerBuiltinTools } from "./tools/builtin.ts";
import { ToolController } from "./tools/controller.ts";
import { DEFAULT_CREATE_LAYOUT } from "./tools/create.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { PaletteSettings, ToolIcon } from "./tools/ToolOverlays.tsx";
import { ListGroup, ListRow, Switch } from "./ui/controls.tsx";
import { LatencyTracker } from "./viewer/latency.ts";
import { Viewer } from "./viewer/Viewer.tsx";
import { listenInCloud, listenOnDevice } from "./voice/listeners.ts";
import { bestEngine, resample, Speaker } from "./voice/speaker.ts";
import { Transcriber } from "./voice/transcriber.ts";
import { VoiceSettingsCard } from "./voice/VoiceSettingsCard.tsx";
import { VoiceInput } from "./voice/voice-input.ts";

declare global {
  interface Window {
    __AEX_SCENE__?: SceneClient;
    __AEX_CAMERA__?: TrackingSession;
    __AEX_VOICE__?: VoiceInput;
    __AEX_SPEECH__?: { speaker: Speaker; roundTrip(text: string): Promise<string | null> };
  }
}

const SETTINGS_ICON =
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z";

/** The microphone indicator: listening for names looks different from a request being spoken. */
const MIC_LABEL = { on: "Mic on", names: "Listening for names", off: "Mic off" } as const;
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
  // The camera and its tracking live as long as the page: the settings sheet and the camera view only show them.
  const session = useMemo(() => {
    const perfDelayMs = Number(new URLSearchParams(location.search).get("perfDelay") ?? 0) || 0;
    return new TrackingSession(bus, { perfDelayMs });
  }, [bus]);
  const camera = useSyncExternalStore(session.subscribe, () => session.getSnapshot().state);
  // Which features are on (Settings > Features) is a user setting kept by the bridge.
  const features = useMemo(
    () =>
      new FeatureFlags(
        (choice) =>
          connection.current?.send({
            type: "settings.set",
            id: crypto.randomUUID(),
            payload: { features: choice },
          }) ?? false,
      ),
    [],
  );
  const featureState = useSyncExternalStore(features.subscribe, features.getSnapshot);
  // Which drawing aids are on (Settings > Drawing aids) is a user setting kept by the bridge too.
  const aids = useMemo(
    () =>
      new DrawingAidsStore(
        (choice) =>
          connection.current?.send({
            type: "settings.set",
            id: crypto.randomUUID(),
            payload: { drawingAids: choice },
          }) ?? false,
      ),
    [],
  );
  const aidState = useSyncExternalStore(aids.subscribe, aids.getSnapshot);
  // The imported models the viewer draws and the project saves, fetched from the bridge as they are first needed.
  const modelAssets = useMemo(() => new ModelAssets(() => window.__AEX_SESSION__ ?? null), []);
  // Saving the project as a Rhino file: the models it uses are fetched, the file is written in a worker, and offered.
  const exporter = useMemo(
    () =>
      new ProjectExporter({
        doc: () => sceneClient.getSnapshot().doc,
        projectName: () =>
          sceneClient.getSnapshot().project?.name ?? sceneClient.getSnapshot().doc?.name ?? "project",
        loadAsset: (id) => modelAssets.whenLoaded(id),
        build: (input) => buildInWorker(input),
        download: (fileName, bytes) => {
          const url = URL.createObjectURL(
            new Blob([bytes as BlobPart], { type: "application/octet-stream" }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = fileName;
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        },
      }),
    [sceneClient, modelAssets],
  );
  // Importing a Rhino model: read in a worker, stored with the bridge, created in one scene transaction.
  const importer = useMemo(
    () =>
      new ModelImporter({
        convert: (bytes, onStage) => convertInWorker(bytes, onStage),
        upload: async (id, bytes) => {
          const session = window.__AEX_SESSION__;
          if (!session) throw new Error("The bridge is not connected.");
          const response = await fetch(assetUrl(session.port, id), {
            method: "PUT",
            headers: { authorization: `Bearer ${session.token}`, "content-type": "application/octet-stream" },
            body: bytes as BodyInit,
          });
          if (!response.ok) {
            const detail = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(detail?.error ?? `The bridge answered ${response.status}.`);
          }
        },
        apply: (label, ops) => sceneClient.apply(label, ops),
      }),
    [sceneClient],
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showHands, setShowHands] = useState(false);
  const renderLatency = useMemo(() => new LatencyTracker(), []);
  const tools = useMemo(() => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    // A tool tied to a feature (the create tools) is available only while that feature is on.
    registry.setAvailability((tool) => !tool.feature || features.on(tool.feature));
    const controller = new ToolController(registry, { tools: DEFAULT_LAYOUT, create: DEFAULT_CREATE_LAYOUT });
    // The rings' layouts are user settings kept by the bridge, so they follow the workspace across browsers and
    // restarts.
    controller.onLayoutChange = (layout, ring) =>
      connection.current?.send({
        type: "settings.set",
        id: crypto.randomUUID(),
        payload: ring === "tools" ? { palette: layout } : { createPalette: layout },
      });
    return controller;
  }, [features]);
  useEffect(() => features.subscribe(() => tools.registry.refresh()), [features, tools]);
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
  // Voice is the main way to ask the agent: transcribed on this laptop unless the user opts into cloud speech.
  const [speech, setSpeech] = useState<SpeechMode>("device");
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const transcriber = useMemo(() => new Transcriber(), []);
  // Mochi's replies are spoken on this laptop: Kokoro on WebGPU, else a voice installed on the computer.
  const [speakReplies, setSpeakReplies] = useState(true);
  const [replyVoice, setReplyVoice] = useState<ReplyVoice>("af_heart");
  const replyVoiceRef = useRef(replyVoice);
  replyVoiceRef.current = replyVoice;
  const speaker = useMemo(() => new Speaker(bestEngine(() => replyVoiceRef.current)), []);
  useEffect(
    () =>
      agent.onLeadReply((reply) => {
        if ("stopped" in reply) speaker.stop();
        else if (reply.event.type === "text.delta") speaker.feed(reply.turnId, reply.event.text);
        else if (reply.event.type === "turn.end") speaker.end(reply.turnId);
      }),
    [agent, speaker],
  );
  // A request is under way, so a reply is coming: the voice loads now rather than at the first sentence.
  useEffect(
    () =>
      agent.subscribe(() => {
        if (agent.getSnapshot().status?.state === "working") speaker.warm();
      }),
    [agent, speaker],
  );
  const voice = useMemo(
    () =>
      new VoiceInput({
        listen: (events) => {
          if (speechRef.current === "cloud") return listenInCloud(events);
          transcriber.load(); // the model loads while the user speaks
          return listenOnDevice(events);
        },
        transcribe: (audio) => transcriber.transcribe(audio),
        send: (text, context) => agent.ask(text, context),
        context: (recorder) => {
          const { doc, selection } = sceneClient.getSnapshot();
          return recorder.resolve(doc, selection, viewLink.groundPoint());
        },
        // While Mochi speaks, what the microphone hears is Mochi: its words never count as a request.
        isNamed: (text) =>
          !speaker.speaking && addressOf(text, agent.getSnapshot().team?.members ?? []).agent !== null,
      }),
    [transcriber, agent, sceneClient, viewLink, speaker],
  );
  const startVoice = () => {
    if (!features.on("voice")) return;
    speaker.stop(); // talking to the agent interrupts its voice before listening starts
    agent.requestOpen();
    void voice.start(() => viewLink.pointedId);
  };
  const startVoiceRef = useRef(startVoice);
  startVoiceRef.current = startVoice;
  const markers = useSyncExternalStore(voice.context.subscribe, () => voice.context.ids);
  const micState = useSyncExternalStore(voice.subscribe, () => voice.micState);
  const [listenForNames, setListenForNames] = useState(false);
  useEffect(() => voice.setHovered(() => viewLink.pointedId), [voice, viewLink]);
  // Listening for names needs the voice feature on.
  useEffect(
    () => voice.setListenForNames(listenForNames && featureState.voice),
    [voice, listenForNames, featureState],
  );

  // What the hand points at, and what gets tapped into the selection, while the user speaks.
  useEffect(() => viewLink.onPointed((id) => voice.context.hover(id, Date.now())), [viewLink, voice]);
  useEffect(() => {
    let previous = sceneClient.getSnapshot().selection;
    return sceneClient.subscribe(() => {
      const { selection } = sceneClient.getSnapshot();
      if (selection !== previous) voice.context.selected(selection, previous);
      previous = selection;
    });
  }, [sceneClient, voice]);

  // Ctrl+, opens and closes the settings, as in most apps.
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  // Hold the ` key to talk (not while typing); releasing it ends the utterance.
  useEffect(() => {
    const typing = (e: KeyboardEvent) =>
      (e.target as HTMLElement).closest("input, textarea, select") !== null;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Backquote" || e.repeat || typing(e)) return;
      e.preventDefault();
      startVoiceRef.current();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Backquote") voice.finish();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [voice]);

  const gestures = useMemo(
    () => ({
      bindings: gestureSettings.getSnapshot,
      enabled: (feature: FeatureId) => features.on(feature),
      agent: {
        // "Yes" and "no" first answer a spoken request waiting to be sent, then the agent's approval card.
        answer: (yes: boolean) => {
          if (voice.reviewing) {
            if (yes) voice.confirm();
            else voice.discard();
            return true;
          }
          return agent.answer(yes, bus.engaged);
        },
        // Both fists, then open hands, stop everything: the team's work and Mochi's voice, even after its reply
        // has ended.
        stop: () => {
          speaker.stop();
          agent.stopRunning();
        },
        ask: () => tools.choose("ask-agent"),
      },
    }),
    [gestureSettings, agent, bus, tools, voice, speaker, features],
  );

  // The camera session goes on the page once mounted; dev builds hand it to end-to-end tests too.
  useEffect(() => {
    const disconnect = session.connect();
    if (import.meta.env.DEV) window.__AEX_CAMERA__ = session;
    return disconnect;
  }, [session]);
  // Dev builds only: lets end-to-end tests edit the scene through the same client the UI uses.
  useEffect(() => {
    if (import.meta.env.DEV) window.__AEX_SCENE__ = sceneClient;
  }, [sceneClient]);
  // Dev builds only: lets end-to-end tests drive what a spoken request captured.
  useEffect(() => {
    if (import.meta.env.DEV) window.__AEX_VOICE__ = voice;
  }, [voice]);
  // Dev builds only: what the voice says, heard back by the recogniser (end-to-end round trip).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__AEX_SPEECH__ = {
      speaker,
      roundTrip: async (text) => {
        const spoken = await speaker.synthesize(text);
        return spoken ? transcriber.transcribe(resample(spoken.audio, spoken.rate, 16_000)) : null;
      },
    };
  }, [speaker, transcriber]);

  useEffect(() => {
    const conn = connectToBridge(window.__AEX_SESSION__ ?? null, browserDeps, setBridge, (message) => {
      if (viewLink.handle(message) || agent.handle(message) || sceneClient.handle(message)) return;
      if (message.type === "settings.snapshot") {
        tools.loadLayout(message.payload.palette ?? DEFAULT_LAYOUT, "tools");
        tools.loadLayout(message.payload.createPalette ?? DEFAULT_CREATE_LAYOUT, "create");
        gestureSettings.load(message.payload.gestures);
        setSpeech(message.payload.speech);
        setListenForNames(message.payload.listenForNames);
        features.load(message.payload.features);
        aids.load(message.payload.drawingAids);
        setShowHands(message.payload.showHands);
        setSpeakReplies(message.payload.speakReplies);
        speaker.setMuted(!message.payload.speakReplies);
        setReplyVoice(message.payload.replyVoice);
      }
    });
    connection.current = conn;
    return () => {
      conn.close();
      viewLink.dispose();
    };
  }, [sceneClient, tools, viewLink, agent, gestureSettings, speaker, features, aids]);

  const askAgent = () => {
    if (!features.on("agent")) return "The agent is switched off in Settings > Features.";
    if (bridge.status !== "connected") return "The agent is not connected: the bridge is offline.";
    const status = agent.getSnapshot().status;
    if (status?.state === "unavailable") return `The agent is not available. ${status.reason}`;
    startVoiceRef.current(); // Ask agent listens: speak the request
    return null;
  };
  /** Keeps a changed setting with the bridge, so it follows the workspace. */
  const saveSetting = (payload: MessageOf<"settings.set">["payload"]) =>
    connection.current?.send({ type: "settings.set", id: crypto.randomUUID(), payload });
  const changeSpeech = (mode: SpeechMode) => {
    setSpeech(mode);
    saveSetting({ speech: mode });
  };
  const changeListenForNames = (on: boolean) => {
    setListenForNames(on);
    saveSetting({ listenForNames: on });
  };
  const changeShowHands = (on: boolean) => {
    setShowHands(on);
    saveSetting({ showHands: on });
  };
  const changeSpeakReplies = (on: boolean) => {
    setSpeakReplies(on);
    speaker.setMuted(!on);
    saveSetting({ speakReplies: on });
  };
  const changeReplyVoice = (value: ReplyVoice) => {
    setReplyVoice(value);
    saveSetting({ replyVoice: value });
  };
  const nameOf = (id: string) => sceneClient.getSnapshot().doc?.elements[id]?.name ?? id;

  const label = LABELS[bridge.status];
  const cameraOn = camera.camera === "on" || camera.camera === "starting";
  const changedFeatures = Object.values(featureState).filter((on) => !on).length;
  const sections: SettingsSection[] = [
    {
      id: "camera",
      title: "Camera and tracking",
      icon: "M3 7h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
      tint: "var(--tint-gray)",
      detail: cameraOn ? "On" : "Off",
      render: () => <CameraSettings session={session} renderLatency={renderLatency} />,
    },
    {
      id: "features",
      title: "Features",
      icon: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
      tint: "var(--tint-blue)",
      detail: changedFeatures > 0 ? `${changedFeatures} off` : "All on",
      render: () => <FeatureSettings flags={features} />,
    },
    {
      id: "drawing-aids",
      title: "Drawing aids",
      icon: "M12 3v5M12 16v5M3 12h5M16 12h5M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
      tint: "var(--tint-green)",
      detail: `${Object.values(aidState).filter(Boolean).length} on`,
      render: () => <DrawingAidsSettings store={aids} />,
    },
    {
      id: "gestures",
      title: "Gestures",
      icon: "M8 13V5a2 2 0 0 1 4 0v6M12 11V4a2 2 0 0 1 4 0v7M16 11V6a2 2 0 0 1 4 0v8a7 7 0 0 1-12.5 4.3L4 14a2 2 0 0 1 3-2.6l1 1.1",
      tint: "var(--tint-orange)",
      render: () => <GestureSettingsCard settings={gestureSettings} bus={bus} />,
    },
    {
      id: "rings",
      title: "Tool rings",
      icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
      tint: "var(--tint-purple)",
      render: () => <PaletteSettings controller={tools} />,
    },
    {
      id: "voice",
      title: "Voice",
      icon: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
      tint: "var(--tint-red)",
      render: () => (
        <VoiceSettingsCard
          mode={speech}
          onMode={changeSpeech}
          listenForNames={listenForNames}
          onListenForNames={changeListenForNames}
          speakReplies={speakReplies}
          onSpeakReplies={changeSpeakReplies}
          replyVoice={replyVoice}
          onReplyVoice={changeReplyVoice}
          speaker={speaker}
          transcriber={transcriber}
        />
      ),
    },
    {
      id: "permissions",
      title: "Agent permissions",
      icon: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z",
      tint: "var(--tint-green)",
      render: () => <AgentPermissions client={agent} />,
    },
  ];
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
          {featureState.voice && (
            <output
              className="status camera"
              data-testid="mic-indicator"
              data-state={micState}
              aria-live="polite"
            >
              <span className="dot" aria-hidden="true" />
              <span>{MIC_LABEL[micState]}</span>
            </output>
          )}
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
          <button
            type="button"
            className="settings-button"
            data-testid="settings-button"
            data-hand-press
            aria-expanded={settingsOpen}
            aria-label="Settings (Ctrl+,)"
            title="Settings (Ctrl+,)"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <ToolIcon path={SETTINGS_ICON} size={17} />
          </button>
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
            features={features}
            aids={aids}
            importer={importer}
            exporter={exporter}
            modelAssets={modelAssets}
            markers={markers}
          >
            {featureState.agent && (
              <AgentPanel
                client={agent}
                voice={voice}
                startVoice={startVoice}
                voiceOn={featureState.voice}
                nameOf={nameOf}
                speaker={speaker}
                speakReplies={speakReplies}
                onSpeakReplies={changeSpeakReplies}
              />
            )}
          </Viewer>
          <CameraView session={session} />
          {label.hint && <p className="hint">{label.hint}</p>}
        </div>
        <SettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          sections={sections}
          quick={
            <ListGroup
              title="For recordings"
              footer="Draws your hands as white shapes over the whole screen, at their pointers, so people watching can follow what your hands do."
            >
              <ListRow
                label="Show my hands"
                control={
                  <Switch
                    label="Show my hands"
                    testId="show-hands"
                    checked={showHands}
                    onChange={changeShowHands}
                  />
                }
              />
            </ListGroup>
          }
        />
      </main>
      <HandOverlay session={session} on={showHands} />
    </div>
  );
}
