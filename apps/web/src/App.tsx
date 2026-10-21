import type { Message, MessageOf, ReplyVoice, SpeechMode } from "@aex/protocol";
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
import { GestureSettingsCard } from "./input/GestureSettingsCard.tsx";
import { GestureSettings } from "./input/gesture-settings.ts";
import { InputBus } from "./input/input-bus.ts";
import { TrackingPanel } from "./perception/TrackingPanel.tsx";
import type { TrackerState } from "./perception/tracker.ts";
import { SceneClient } from "./scene/scene-client.ts";
import { DEFAULT_LAYOUT, registerBuiltinTools } from "./tools/builtin.ts";
import { ToolController } from "./tools/controller.ts";
import { DEFAULT_CREATE_LAYOUT } from "./tools/create.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { PaletteSettings } from "./tools/ToolOverlays.tsx";
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
    __AEX_VOICE__?: VoiceInput;
    __AEX_SPEECH__?: { speaker: Speaker; roundTrip(text: string): Promise<string | null> };
  }
}

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
    [gestureSettings, agent, bus, tools, voice, speaker],
  );

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
        voice.setListenForNames(message.payload.listenForNames);
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
  }, [sceneClient, tools, viewLink, agent, gestureSettings, voice, speaker]);

  const askAgent = () => {
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
    voice.setListenForNames(on);
    saveSetting({ listenForNames: on });
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
            className="status camera"
            data-testid="mic-indicator"
            data-state={micState}
            aria-live="polite"
          >
            <span className="dot" aria-hidden="true" />
            <span>{MIC_LABEL[micState]}</span>
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
            markers={markers}
          >
            <AgentPanel
              client={agent}
              voice={voice}
              startVoice={startVoice}
              nameOf={nameOf}
              speaker={speaker}
              speakReplies={speakReplies}
              onSpeakReplies={changeSpeakReplies}
            />
          </Viewer>
          {label.hint && <p className="hint">{label.hint}</p>}
        </div>
        <aside className="sidebar" aria-label="Tracking">
          <TrackingPanel onCameraState={setCamera} bus={bus} renderLatency={renderLatency} />
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
          <GestureSettingsCard settings={gestureSettings} bus={bus} />
          <PaletteSettings controller={tools} />
          <AgentPermissions client={agent} />
        </aside>
      </main>
    </div>
  );
}
