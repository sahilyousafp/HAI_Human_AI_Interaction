import {
  DEFAULT_ACTION_LAYOUT,
  DEFAULT_REFERENCE_LAYOUT,
  type FeatureId,
  type Hand,
  type Message,
  type MessageOf,
  type ModellingMode,
  type ReplyVoice,
  type SpeechMode,
} from "@hai/protocol";
import { elementsInScope } from "@hai/scene";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AgentPanel, AgentPermissions } from "./agent/AgentPanel.tsx";
import { addressOf } from "./agent/addressing.ts";
import { AgentClient } from "./agent/agent-client.ts";
import { answerYesNo } from "./agent/answer.ts";
import { agentColors, claimBoxes } from "./agent/owners.ts";
import { ViewLink } from "./agent/view-link.ts";
import {
  type BridgeConnection,
  browserDeps,
  type ConnectionState,
  connectToBridge,
} from "./bridge/connection.ts";
import { ContextLegend } from "./context/ContextLegend.tsx";
import { ContextClient } from "./context/context-client.ts";
import { ProjectExporter } from "./export/exporter.ts";
import { buildInWorker } from "./export/rhino-client.ts";
import { ModelImporter } from "./import/importer.ts";
import { assetUrl, ModelAssets, mirrorAssetUrl } from "./import/model-assets.ts";
import { convertInWorker } from "./import/rhino-client.ts";
import { GestureSettingsCard } from "./input/GestureSettingsCard.tsx";
import { GestureSettings } from "./input/gesture-settings.ts";
import { InputBus } from "./input/input-bus.ts";
import { OpenDataSettings } from "./open-data/OpenDataSettings.tsx";
import { OpenDataStore } from "./open-data/open-data-store.ts";
import { PanelClient } from "./panel/panel-client.ts";
import { CameraSettings } from "./perception/CameraSettings.tsx";
import { CameraView } from "./perception/CameraView.tsx";
import { HandOverlay } from "./perception/HandOverlay.tsx";
import { TrackingSession } from "./perception/tracking-session.ts";
import { ModellingSettings } from "./rhino/ModellingSettings.tsx";
import { RhinoMirror } from "./rhino/rhino-mirror.ts";
import { rhinoPill } from "./rhino/rhino-view.ts";
import { SceneClient } from "./scene/scene-client.ts";
import { DrawingAidsSettings } from "./settings/DrawingAidsSettings.tsx";
import { DrawingAidsStore } from "./settings/drawing-aids.ts";
import { FeatureSettings } from "./settings/FeatureSettings.tsx";
import { FeatureFlags } from "./settings/feature-flags.ts";
import { SettingsPanel, type SettingsSection } from "./settings/SettingsPanel.tsx";
import { FirstRun, useModelsState, useUpdateState } from "./setup/FirstRun.tsx";
import { SetupSettings } from "./setup/SetupSettings.tsx";
import { updatesView } from "./setup/updates-view.ts";
import { registerBuiltinTools } from "./tools/builtin.ts";
import { ToolController } from "./tools/controller.ts";
import type { HoldReport, RouterTalk } from "./tools/input-router.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { PaletteSettings, ToolIcon } from "./tools/ToolOverlays.tsx";
import { ListGroup, ListRow, Switch } from "./ui/controls.tsx";
import { cameraMarkers } from "./viewer/camera-markers.tsx";
import { LatencyTracker } from "./viewer/latency.ts";
import { NO_OWNERS, type OwnerDisplay } from "./viewer/owner-display.tsx";
import { Viewer } from "./viewer/Viewer.tsx";
import { voiceAvailability, voicePillText } from "./voice/availability.ts";
import { listenInCloud, listenOnDevice, preloadOnDevice } from "./voice/listeners.ts";
import { bestEngine, resample, Speaker } from "./voice/speaker.ts";
import { toolNamed } from "./voice/tool-commands.ts";
import { Transcriber } from "./voice/transcriber.ts";
import { VoiceSettingsCard } from "./voice/VoiceSettingsCard.tsx";
import { VoiceInput } from "./voice/voice-input.ts";

declare global {
  interface Window {
    __HAI_SCENE__?: SceneClient;
    __HAI_PANELS__?: PanelClient;
    __HAI_MIRROR__?: RhinoMirror;
    __HAI_CAMERA__?: TrackingSession;
    __HAI_VOICE__?: VoiceInput;
    __HAI_SPEECH__?: { speaker: Speaker; roundTrip(text: string): Promise<string | null> };
  }
}

const SETTINGS_ICON =
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z";

/** The microphone indicator: listening for names looks different from a request being spoken. */
const MIC_LABEL = { on: "Mic on", names: "Listening for names", off: "Mic off" } as const;
/** The Rhino pill reuses the connection pill's look: green when connected, pulsing while syncing, amber when absent. */
const RHINO_PILL_STATE = { on: "connected", busy: "connecting", off: "offline" } as const;
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
  // The generated panel the agent offers, and the preview its controls make.
  const panels = useMemo(
    () =>
      new PanelClient({
        send: (message: Message) => connection.current?.send(message) ?? false,
        scene: sceneClient,
        runningTurn: (name) => agent.runningTurnId(name),
      }),
    [sceneClient, agent],
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
  const modelAssets = useMemo(() => new ModelAssets(() => window.__HAI_SESSION__ ?? null), []);
  // Rhino's objects, drawn read-only beside the scene while Rhino is connected, and their meshes from the bridge.
  const mirror = useMemo(
    () => new RhinoMirror((message: Message) => connection.current?.send(message) ?? false),
    [],
  );
  const mirrorAssets = useMemo(
    () => new ModelAssets(() => window.__HAI_SESSION__ ?? null, undefined, mirrorAssetUrl),
    [],
  );
  const rhinoState = useSyncExternalStore(mirror.subscribe, mirror.getStatus);
  // Open data (Settings > Open data): the source choices, the project's site and the requests made.
  const openData = useMemo(
    () => new OpenDataStore((message: Message) => connection.current?.send(message) ?? false),
    [],
  );
  // The city context the agents fetched, drawn read-only beside the model.
  const contextClient = useMemo(() => new ContextClient(), []);
  const contextState = useSyncExternalStore(contextClient.subscribe, contextClient.getSnapshot);
  const openDataState = useSyncExternalStore(openData.subscribe, openData.getSnapshot);
  // Who owns what: tint and outline in the agents' colours, region claims as boxes, and the claim under the pointer in
  // the panel lit. Only while Parallel modelling is on; the owner tint and boxes follow Show owners.
  // Outline and tint what agents own, and draw their region claims (Settings > Modelling > Show owners).
  const [showOwners, setShowOwners] = useState(true);
  // A small marker in the model for each camera an agent placed (Settings > Modelling > Show cameras).
  const [showCameras, setShowCameras] = useState(true);
  const [maxSessions, setMaxSessions] = useState(6);
  const agentState = useSyncExternalStore(agent.subscribe, agent.getSnapshot);
  const sceneState = useSyncExternalStore(sceneClient.subscribe, sceneClient.getSnapshot);
  const owners = useMemo<OwnerDisplay>(() => {
    const team = agentState.team;
    if (!team || !featureState.parallelModelling) return NO_OWNERS;
    const lit = team.claims.find((c) => c.taskId === agentState.highlightedClaim);
    return {
      colors: showOwners ? agentColors(team.members) : NO_OWNERS.colors,
      boxes: showOwners ? claimBoxes(team.claims, team.members, sceneState.doc) : [],
      highlight:
        lit && sceneState.doc
          ? new Set(elementsInScope(lit.scope, sceneState.doc).map((e) => e.id))
          : NO_OWNERS.highlight,
      highlightColor: lit ? (team.members.find((m) => m.name === lit.agent)?.color ?? null) : null,
    };
  }, [
    agentState.team,
    agentState.highlightedClaim,
    featureState.parallelModelling,
    showOwners,
    sceneState.doc,
  ]);
  const cameraMarkerList = useMemo(
    () =>
      showCameras && agentState.team ? cameraMarkers(agentState.team.cameras, agentState.team.members) : [],
    [showCameras, agentState.team],
  );
  // How long a change in Rhino takes to be drawn here, refreshed twice a second.
  const [rhinoMs, setRhinoMs] = useState<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => setRhinoMs(mirror.latencyP90()), 500);
    return () => clearInterval(id);
  }, [mirror]);
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
          const session = window.__HAI_SESSION__;
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
  // Settings > Setup shows the first-run screens again (desktop app only).
  const [setupOpen, setSetupOpen] = useState(false);
  // The top bar's update pill asks the settings to show the Setup page.
  const [settingsRequest, setSettingsRequest] = useState<{ page: string; seq: number } | null>(null);
  const [showHands, setShowHands] = useState(false);
  const renderLatency = useMemo(() => new LatencyTracker(), []);
  const tools = useMemo(() => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    // A tool tied to a feature (the create tools) is available only while that feature is on.
    registry.setAvailability((tool) => !tool.feature || features.on(tool.feature));
    const controller = new ToolController(registry, {
      action: DEFAULT_ACTION_LAYOUT,
      reference: DEFAULT_REFERENCE_LAYOUT,
    });
    // The rings' layouts are user settings kept by the bridge, so they follow the workspace across browsers and
    // restarts.
    controller.onLayoutChange = (layout, ring) =>
      connection.current?.send({
        type: "settings.set",
        id: crypto.randomUUID(),
        payload: ring === "action" ? { palette: layout } : { createPalette: layout },
      });
    // Markers are kept with the project by the bridge, so every viewer and every agent sees the same ones.
    controller.references.onMarkersChange = (markers) =>
      connection.current?.send({ type: "markers.set", id: crypto.randomUUID(), payload: { markers } });
    controller.onDominantHandChange = (dominantHand) =>
      connection.current?.send({ type: "settings.set", id: crypto.randomUUID(), payload: { dominantHand } });
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
  // A long pinch goes by role (the dominant hand's ring, the other hand's talk), so the defaults follow that setting.
  useEffect(() => {
    const follow = () => gestureSettings.setDominant(tools.getSnapshot().dominantHand);
    follow();
    return tools.subscribe(follow);
  }, [tools, gestureSettings]);
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
  // A request carries the sketches the user drew for it (without which hand drew them), and clears them once sent.
  useEffect(
    () =>
      agent.attachReferences({
        sketches: () => tools.references.sketches.map(({ hand: _hand, ...sketch }) => sketch),
        sent: () => tools.references.clearSketches(),
      }),
    [agent, tools],
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
        // A shake right after a held request was sent stops it: its turn and what it handed out.
        stopSent: () => agent.stopLastRequest(),
        // A transcript that is only a tool's name ("measure", "sketch area") picks the tool, without the agent.
        command: (text) => {
          const tool = toolNamed(text, tools.registry.list());
          if (!tool) return null;
          tools.choose(tool.id);
          return tool.label;
        },
        isBareName: (text) => {
          const { agent: named, text: rest } = addressOf(text, agent.getSnapshot().team?.members ?? []);
          return named !== null && rest.trim() === "";
        },
      }),
    [transcriber, agent, sceneClient, viewLink, speaker, tools],
  );
  // In the desktop app the voice models are downloaded after install: until they are in place the voice says so, the
  // speaker stays quiet and nothing asks for them. When they verify, voice starts without a reload.
  const modelsState = useModelsState(window.haiDesktop);
  // An update that is ready waits to restart while an agent turn is running, so the app is told when one is.
  const updateState = useUpdateState(window.haiDesktop);
  const update = updateState ? updatesView(updateState) : null;
  const agentWorking = useSyncExternalStore(
    agent.subscribe,
    () => agent.getSnapshot().status?.state === "working",
  );
  useEffect(() => {
    window.haiDesktop?.updates?.setBusy(agentWorking).catch(() => {});
  }, [agentWorking]);
  const voiceStatus = useMemo(
    () => voiceAvailability(Boolean(window.haiDesktop), modelsState),
    [modelsState],
  );
  const voiceReady = voiceStatus.kind === "ready";
  /** What the hand rests on while the user speaks: nothing, unless they turned on Number what I point at. */
  const pointedWhileSpeaking = useCallback(
    () => (features.on("pointCapture") ? viewLink.pointedId : null),
    [features, viewLink],
  );
  useEffect(() => speaker.setHeld(!voiceReady), [speaker, voiceReady]);
  const startVoice = () => {
    if (!features.on("voice") || !voiceReady) return;
    speaker.stop(); // talking to the agent interrupts its voice before listening starts
    agent.requestOpen();
    void voice.start(pointedWhileSpeaking);
  };
  const startVoiceRef = useRef(startVoice);
  startVoiceRef.current = startVoice;
  const markers = useSyncExternalStore(voice.context.subscribe, () => voice.context.ids);
  const micState = useSyncExternalStore(voice.subscribe, () => voice.micState);
  const [listenForNames, setListenForNames] = useState(false);
  useEffect(() => voice.setHovered(pointedWhileSpeaking), [voice, pointedWhileSpeaking]);
  // Listening for names needs the voice feature on.
  useEffect(
    () => voice.setListenForNames(listenForNames && featureState.voice && voiceReady),
    [voice, listenForNames, featureState, voiceReady],
  );

  // What the hand points at, and what gets tapped into the selection, while the user speaks.
  useEffect(
    () =>
      viewLink.onPointed((id) => {
        // While a pinch is held, the holding hand points (see `talk` below), whatever the setting.
        if (voice.holding) return;
        voice.context.hover(features.on("pointCapture") ? id : null, Date.now());
      }),
    [viewLink, voice, features],
  );
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

  // Hold to talk listens the moment the hold fires: the speech detector and model load at the first engagement
  // instead (the microphone stays off until a hold or a request opens it).
  useEffect(
    () =>
      bus.onEngaged((engaged) => {
        if (!engaged || !features.on("voice") || speechRef.current !== "device") return;
        preloadOnDevice();
        transcriber.load();
      }),
    [bus, features, transcriber],
  );
  // Hold to talk: a long pinch locks what is under the hand ("this") and listens while it is held. While speaking,
  // the hand points: the elements and the points it rests on are captured. Released, what was said is sent at once.
  const voiceReadyRef = useRef(voiceReady);
  voiceReadyRef.current = voiceReady;
  const talk = useMemo<RouterTalk>(
    () => ({
      start: (position, hand) => {
        if (!features.on("voice") || !voiceReadyRef.current) return false;
        const target = tools.lockTarget(tools.viewerOf(position), hand);
        if (voice.startHeld(hand, target)) return true;
        tools.releaseTarget();
        return false;
      },
      move: (position, hand) => {
        const at = tools.pointAt(tools.viewerOf(position), hand);
        const now = Date.now();
        voice.context.hover(at?.elementId ?? null, now);
        voice.context.rest(at && !at.elementId ? at.point : null, now);
      },
      end: (_hand, send) => {
        tools.releaseTarget();
        voice.releaseHeld(send);
      },
      onSpeech: (listener) => voice.onHeldSpeech(listener),
    }),
    [features, tools, voice],
  );
  const gestures = useMemo(
    () => ({
      bindings: gestureSettings.getSnapshot,
      enabled: (feature: FeatureId) => features.on(feature),
      ringOf: (hand: Hand) => tools.ringOf(hand),
      talk,
      onHold: (report: HoldReport) => session.detection.countHold(report),
      agent: {
        // "Yes" and "no" answer, in this order: a spoken request waiting to be sent, the agent's approval card, a
        // panel offer; then the active tool's own question.
        answer: (yes: boolean) =>
          answerYesNo(yes, {
            voice,
            approvals: {
              get waiting() {
                return agent.pending.length;
              },
              answer: (y) => agent.answer(y, bus.engaged),
            },
            offers: { answer: (y) => panels.answerOnly(y, bus.engaged) },
          }),
        // Both fists, then open hands, stop everything: the team's work and Mochi's voice, even after its reply
        // has ended.
        stop: () => {
          speaker.stop();
          agent.stopRunning();
        },
        ask: () => tools.choose("ask-agent"),
      },
    }),
    [gestureSettings, agent, bus, tools, voice, speaker, features, panels, talk, session],
  );

  // The camera session goes on the page once mounted; dev builds hand it to end-to-end tests too.
  useEffect(() => {
    const disconnect = session.connect();
    if (import.meta.env.DEV) window.__HAI_CAMERA__ = session;
    return disconnect;
  }, [session]);
  // Dev builds only: lets end-to-end tests edit the scene through the same client the UI uses.
  useEffect(() => {
    if (import.meta.env.DEV) window.__HAI_SCENE__ = sceneClient;
  }, [sceneClient]);
  // Dev builds only: lets end-to-end tests read what Rhino reports.
  useEffect(() => {
    if (import.meta.env.DEV) window.__HAI_MIRROR__ = mirror;
  }, [mirror]);
  // Dev builds only: lets end-to-end tests see what the viewer draws with a panel's preview over the scene.
  useEffect(() => {
    if (import.meta.env.DEV) window.__HAI_PANELS__ = panels;
  }, [panels]);
  // Dev builds only: lets end-to-end tests drive what a spoken request captured.
  useEffect(() => {
    if (import.meta.env.DEV) window.__HAI_VOICE__ = voice;
  }, [voice]);
  // Dev builds only: what the voice says, heard back by the recogniser (end-to-end round trip).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__HAI_SPEECH__ = {
      speaker,
      roundTrip: async (text) => {
        const spoken = await speaker.synthesize(text);
        return spoken ? transcriber.transcribe(resample(spoken.audio, spoken.rate, 16_000)) : null;
      },
    };
  }, [speaker, transcriber]);

  useEffect(() => {
    const conn = connectToBridge(window.__HAI_SESSION__ ?? null, browserDeps, setBridge, (message) => {
      if (
        viewLink.handle(message) ||
        agent.handle(message) ||
        panels.handle(message) ||
        mirror.handle(message) ||
        openData.handle(message) ||
        contextClient.handle(message) ||
        sceneClient.handle(message)
      )
        return;
      if (message.type === "markers.snapshot") {
        tools.references.loadMarkers(message.payload.markers);
        return;
      }
      if (message.type === "settings.snapshot") {
        tools.loadLayout(message.payload.palette ?? DEFAULT_ACTION_LAYOUT, "action");
        tools.loadLayout(message.payload.createPalette ?? DEFAULT_REFERENCE_LAYOUT, "reference");
        tools.loadDominantHand(message.payload.dominantHand);
        gestureSettings.load(message.payload.gestures);
        setSpeech(message.payload.speech);
        setListenForNames(message.payload.listenForNames);
        features.load(message.payload.features);
        aids.load(message.payload.drawingAids);
        setShowHands(message.payload.showHands);
        setShowOwners(message.payload.showOwners);
        setShowCameras(message.payload.showCameras);
        setMaxSessions(message.payload.maxSessions);
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
  }, [
    sceneClient,
    tools,
    viewLink,
    agent,
    panels,
    mirror,
    openData,
    contextClient,
    gestureSettings,
    speaker,
    features,
    aids,
  ]);

  // A panel needs the bridge (its Done sends the result there) and its feature: without either it closes and its
  // preview goes, so the model shows what the bridge has.
  useEffect(() => {
    if (bridge.status !== "connected" || !featureState.generatedPanels) panels.reset();
  }, [bridge.status, featureState.generatedPanels, panels]);

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
  const changeModelling = (mode: ModellingMode) => saveSetting({ modelling: mode });
  /** Brings a .3dm the agent wrote into the viewer: fetched from the bridge, then imported as any file is. */
  const importWritten = (path: string) => {
    void importer.importFile({
      name: path.split("/").at(-1) ?? path,
      arrayBuffer: async () => {
        const session = window.__HAI_SESSION__;
        if (!session) throw new Error("The bridge is not connected.");
        const url = `http://127.0.0.1:${session.port}/project-file/${path.split("/").map(encodeURIComponent).join("/")}`;
        const response = await fetch(url, { headers: { authorization: `Bearer ${session.token}` } });
        if (!response.ok) throw new Error(`The bridge answered ${response.status} for ${path}.`);
        return response.arrayBuffer();
      },
    });
  };
  const openWrittenInRhino = (path: string) => {
    connection.current?.send({ type: "rhino.open", id: crypto.randomUUID(), payload: { path } });
  };
  const changeShowOwners = (on: boolean) => {
    setShowOwners(on);
    saveSetting({ showOwners: on });
  };
  const changeShowCameras = (on: boolean) => {
    setShowCameras(on);
    saveSetting({ showCameras: on });
  };
  const changeMaxSessions = (limit: number) => {
    setMaxSessions(limit);
    saveSetting({ maxSessions: limit });
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
      id: "modelling",
      title: "Modelling",
      icon: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
      tint: "var(--tint-blue)",
      detail: rhinoState.inUse === "rhino" ? "Rhino" : "Python only",
      render: () => (
        <ModellingSettings
          mirror={mirror}
          onChange={changeModelling}
          showOwners={showOwners}
          onShowOwners={changeShowOwners}
          showCameras={showCameras}
          onShowCameras={changeShowCameras}
          maxSessions={maxSessions}
          onMaxSessions={changeMaxSessions}
        />
      ),
    },
    {
      id: "open-data",
      title: "Open data",
      icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z",
      tint: "var(--tint-green)",
      detail: featureState.openData ? "On" : "Off",
      render: () => <OpenDataSettings store={openData} flags={features} />,
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
      detail: voicePillText(voiceStatus) ?? undefined,
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
          availability={voiceStatus}
          onDownload={() => {
            window.haiDesktop?.models.start().catch(() => {});
          }}
        />
      ),
    },
    ...(window.haiDesktop
      ? [
          {
            id: "setup",
            title: "Setup",
            icon: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
            tint: "var(--tint-gray)",
            render: () => (
              <SetupSettings
                desktop={window.haiDesktop as NonNullable<typeof window.haiDesktop>}
                onOpen={() => {
                  setSettingsOpen(false);
                  setSetupOpen(true);
                }}
              />
            ),
          },
        ]
      : []),
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
          <span className="wordmark">HAI</span>
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
              data-state={voiceReady ? micState : voiceStatus.kind}
              aria-live="polite"
            >
              <span className="dot" aria-hidden="true" />
              <span>{voicePillText(voiceStatus) ?? MIC_LABEL[micState]}</span>
            </output>
          )}
          {(() => {
            const pill = rhinoPill(rhinoState);
            return pill ? (
              <output
                className="status"
                data-testid="rhino-status"
                data-state={RHINO_PILL_STATE[pill.tone]}
                data-rhino={pill.tone}
                aria-live="polite"
              >
                <span className="dot" aria-hidden="true" />
                <span>{pill.text}</span>
              </output>
            ) : null;
          })()}
          {rhinoState.connected && rhinoMs !== null && (
            <output className="status" data-testid="rhino-latency" aria-live="off">
              <span className="dot" aria-hidden="true" />
              <span>Rhino to HAI {Math.round(rhinoMs)} ms</span>
            </output>
          )}
          {update?.pill && (
            <button
              type="button"
              className="status update-pill"
              data-testid="update-pill"
              data-tone={update.tone}
              data-hand-press
              title="Open the update in Settings"
              onClick={() => {
                setSettingsOpen(true);
                setSettingsRequest((r) => ({ page: "setup", seq: (r?.seq ?? 0) + 1 }));
              }}
            >
              <span className="update-dot" aria-hidden="true" />
              <span>{update.pill}</span>
            </button>
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
            panels={panels}
            mirror={mirror}
            mirrorAssets={mirrorAssets}
            markers={markers}
            voice={voice}
            owners={owners}
            cameraMarkers={cameraMarkerList}
            context={contextState}
            showContext={openDataState.showContext}
          >
            <ContextLegend state={contextState} visible={openDataState.showContext} />
            {featureState.agent && (
              <AgentPanel
                client={agent}
                panels={panels}
                voice={voice}
                startVoice={startVoice}
                voiceOn={featureState.voice}
                voiceNotice={voiceReady ? null : voiceStatus.label}
                nameOf={nameOf}
                speaker={speaker}
                speakReplies={speakReplies}
                onSpeakReplies={changeSpeakReplies}
                rhinoConnected={rhinoState.connected && rhinoState.mode !== "python"}
                onImportFile={importWritten}
                onOpenInRhino={openWrittenInRhino}
              />
            )}
          </Viewer>
          <CameraView session={session} />
          {label.hint && <p className="hint">{label.hint}</p>}
        </div>
        <SettingsPanel
          open={settingsOpen}
          request={settingsRequest}
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
      <FirstRun desktop={window.haiDesktop} forced={setupOpen} onClose={() => setSetupOpen(false)} />
    </div>
  );
}
