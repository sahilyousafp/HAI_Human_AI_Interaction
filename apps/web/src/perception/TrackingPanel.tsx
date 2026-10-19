import { pinchPoint } from "@aex/perception";
import type { GestureEvent, TrackedHand, TrackingFrame } from "@aex/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InputBus } from "../input/input-bus.ts";
import type { LatencyTracker } from "../viewer/latency.ts";
import { CAMERA_EFFECTS, type CameraEffectsState, EFFECT_NAMES } from "./camera-effects.ts";
import { type CameraPrefs, loadCameraPrefs, mirroredFor, saveCameraPrefs } from "./camera-prefs.ts";
import { DetectionPanel } from "./DetectionPanel.tsx";
import { DetectionStore } from "./detection-store.ts";
import { type DrawColors, drawTracking } from "./draw.ts";
import { GesturePanel } from "./GesturePanel.tsx";
import { GestureStore } from "./gesture-store.ts";
import { downloadFrames, LandmarkRecorder } from "./recorder.ts";
import {
  type CameraError,
  type CameraInfo,
  Tracker,
  type TrackerState,
  type TrackerStats,
} from "./tracker.ts";

const ERROR_TEXT: Record<CameraError, { title: string; fix: string }> = {
  denied: {
    title: "Camera permission was denied.",
    fix: "Click the camera icon in the address bar (or open Site settings), allow the camera, then start it again.",
  },
  "not-found": {
    title: "No camera was found.",
    fix: "Connect a webcam or enable the built-in one in Windows Settings > Privacy & security > Camera.",
  },
  "in-use": {
    title: "The camera is being used by another app.",
    fix: "Close Teams, Zoom or any other app using the camera, then start it again.",
  },
  unknown: {
    title: "The camera could not start.",
    fix: "Reload the page and try again. Mouse and keyboard keep working.",
  },
};

interface Summary {
  seq: number;
  hands: string[];
  face: boolean;
  faceRan: boolean;
  yaw: number | null;
  pitch: number | null;
  captureTs: number;
  inferenceDoneTs: number;
}

declare global {
  interface Window {
    /** Dev builds only: recent frame summaries for end-to-end tests. Never contains pixels. */
    __AEX_TRACKING__?: { frames: Summary[]; faceCadence: 1 | 2 };
    /** Dev builds only: recent gesture events for end-to-end tests. */
    __AEX_GESTURES__?: { events: GestureEvent[] };
  }
}

function readColors(el: Element): DrawColors {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    left: v("--hand-left"),
    right: v("--hand-right"),
    face: v("--face-points"),
    axisX: v("--risk"),
    axisY: v("--ok"),
    axisZ: v("--axis-z"),
    raw: v("--raw-points"),
  };
}

const EFFECTS_FIX =
  "Turn them off in Quick settings (Windows+A) > Studio effects, or Settings > Bluetooth & devices > Cameras > your camera.";

function effectsOn(effects: CameraEffectsState | null): string[] {
  return effects ? CAMERA_EFFECTS.filter((e) => effects[e] === "on").map((e) => EFFECT_NAMES[e]) : [];
}

function effectsLabel(effects: CameraEffectsState | null): string {
  if (!effects) return "-";
  const on = effectsOn(effects);
  if (on.length > 0) return on.join(", ");
  return CAMERA_EFFECTS.every((e) => effects[e] === "off") ? "off" : "not reported";
}

async function listCameras(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}

function cameraLabel(info: CameraInfo | null): string {
  if (!info?.width || !info.height) return "-";
  const fps = info.frameRate ? `, ${Math.round(info.frameRate)} fps` : "";
  return `${info.width} x ${info.height}${fps}`;
}

function faceCadenceLabel(state: TrackerState, stats: TrackerStats | null): string {
  if (state.camera !== "on") return "-";
  return stats?.faceCadence === 2 ? "every 2nd frame" : "every frame";
}

interface TrackingPanelProps {
  onCameraState(state: TrackerState): void;
  /** Where hand input goes: gestures, the pointer and engagement. */
  bus: InputBus;
  /** Gesture-to-render latency, measured by the viewer. */
  renderLatency: LatencyTracker;
}

export function TrackingPanel({ onCameraState, bus, renderLatency }: TrackingPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<Tracker | null>(null);
  const latestFrame = useRef<TrackingFrame | null>(null);
  const latestStats = useRef<TrackerStats | null>(null);
  const latestRaw = useRef<TrackedHand[]>([]);
  const latestFaceRan = useRef(false);
  const [state, setState] = useState<TrackerState>({ camera: "off" });
  const [stats, setStats] = useState<TrackerStats | null>(null);
  const [headPose, setHeadPose] = useState<TrackingFrame["face"] | null>(null);
  const [debugView, setDebugView] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const recorderRef = useRef(new LandmarkRecorder());
  const gestureStore = useRef(new GestureStore()).current;
  const detectionStore = useRef(new DetectionStore()).current;
  const [recording, setRecording] = useState(false);
  const [effects, setEffects] = useState<CameraEffectsState | null>(null);
  const [prefs, setPrefs] = useState<CameraPrefs>(loadCameraPrefs);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraInfo, setCameraInfo] = useState<CameraInfo | null>(null);

  const updateState = useCallback(
    (next: TrackerState) => {
      setState(next);
      onCameraState(next);
    },
    [onCameraState],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const perfDelayMs = Number(new URLSearchParams(location.search).get("perfDelay") ?? 0) || 0;
    const tracker = new Tracker(
      video,
      {
        onState: updateState,
        onEffects: setEffects,
        onCamera: setCameraInfo,
        onGestures: (events, gestureState, gestureMs) => {
          gestureStore.push(events, gestureState, gestureMs);
          // The frame these gestures came from was delivered just before, in onFrame.
          if (latestFrame.current) {
            detectionStore.push(latestFrame.current, latestFaceRan.current, gestureState, events);
          }
          bus.setEngaged(gestureState.engaged);
          bus.emitGestures(events);
          if (import.meta.env.DEV && events.length > 0) {
            if (!window.__AEX_GESTURES__) window.__AEX_GESTURES__ = { events: [] };
            const log = window.__AEX_GESTURES__.events;
            log.push(...events);
            if (log.length > 500) log.splice(0, log.length - 500);
          }
        },
        onFrame: (frame, frameStats, faceRan, rawHands) => {
          latestFrame.current = frame;
          latestFaceRan.current = faceRan;
          // The pointer follows the right hand's pinch point, or the left hand if only it is visible; with both
          // hands in view, the left one gets a second pointer.
          const right = frame.hands.find((h) => h.handedness === "Right");
          const left = frame.hands.find((h) => h.handedness === "Left");
          const primary = right ?? left;
          bus.emitPointer({
            position: primary ? pinchPoint(primary) : null,
            secondary: right && left ? pinchPoint(left) : null,
            ...(frame.aspect ? { aspect: frame.aspect } : {}),
            ts: frame.captureTs,
          });
          latestRaw.current = rawHands ?? [];
          latestStats.current = frameStats;
          if (import.meta.env.DEV) {
            recorderRef.current.push(frame);
            if (!window.__AEX_TRACKING__) window.__AEX_TRACKING__ = { frames: [], faceCadence: 1 };
            const store = window.__AEX_TRACKING__;
            store.faceCadence = frameStats.faceCadence;
            store.frames.push({
              seq: frame.seq,
              hands: frame.hands.map((h) => h.handedness),
              face: Boolean(frame.face),
              faceRan,
              yaw: frame.face?.headPose.yaw ?? null,
              pitch: frame.face?.headPose.pitch ?? null,
              captureTs: frame.captureTs,
              inferenceDoneTs: frame.inferenceDoneTs,
            });
            if (store.frames.length > 600) store.frames.splice(0, store.frames.length - 600);
          }
        },
      },
      { perfDelayMs },
    );
    trackerRef.current = tracker;
    if (import.meta.env.DEV) window.__AEX_RECORDER__ = recorderRef.current;
    return () => tracker.stop();
  }, [updateState, gestureStore, detectionStore, bus]);

  // Redraw the overlay every animation frame from the latest result; no React render per frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    let colors = readColors(canvas);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const refreshColors = () => {
      colors = readColors(canvas);
    };
    scheme.addEventListener("change", refreshColors);
    const tick = () => {
      drawTracking(ctx, debugView ? latestFrame.current : null, colors, showRaw ? latestRaw.current : []);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      scheme.removeEventListener("change", refreshColors);
    };
  }, [debugView, showRaw]);

  useEffect(() => {
    trackerRef.current?.setRawHands(showRaw);
  }, [showRaw]);

  useEffect(() => {
    trackerRef.current?.setMirrored(prefs.mirrored);
  }, [prefs.mirrored]);

  useEffect(() => {
    void trackerRef.current?.setDevice(prefs.deviceId);
  }, [prefs.deviceId]);

  // The camera list; names are only readable once camera permission is granted, so refresh when the camera starts.
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const refresh = () => void listCameras().then(setCameras);
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, []);
  useEffect(() => {
    if (state.camera === "on") void listCameras().then(setCameras);
  }, [state.camera]);

  const choosePrefs = (next: CameraPrefs) => {
    setPrefs(next);
    saveCameraPrefs(next);
  };

  // Text readouts refresh once per second.
  useEffect(() => {
    const id = setInterval(() => {
      setStats(latestStats.current ? { ...latestStats.current } : null);
      setHeadPose(latestFrame.current?.face ?? null);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const running = state.camera === "on" || state.camera === "starting";
  const toggle = () => {
    if (running) {
      trackerRef.current?.stop();
      latestFrame.current = null;
      latestStats.current = null;
      setStats(null);
      gestureStore.reset();
      detectionStore.reset();
      setEffects(null);
      setCameraInfo(null);
    } else {
      void trackerRef.current?.start();
    }
  };

  const backend = state.camera === "on" ? state.backend : null;
  const effectsStillOn = effectsOn(effects);
  const effectsText = effectsLabel(effects);

  const toggleRecording = () => {
    const recorder = recorderRef.current;
    if (recorder.active) {
      downloadFrames(recorder.stop());
      setRecording(false);
    } else {
      recorder.start();
      setRecording(true);
    }
  };

  return (
    <section className="tracking" aria-label="Camera tracking">
      <div className="main-column">
        <div className="preview" data-camera={state.camera} data-mirrored={prefs.mirrored}>
          <video ref={videoRef} className="preview-video" muted playsInline />
          <canvas
            ref={canvasRef}
            className="preview-overlay"
            width={640}
            height={480}
            role="img"
            aria-label="Tracked hand and face points over the camera preview"
          />
          {state.camera !== "on" && (
            <div className="preview-empty">
              {state.camera === "starting" ? <p>Starting camera and loading models...</p> : null}
              {state.camera === "off" ? (
                <p>The camera is off. Video stays in this browser tab; only hand and face points are used.</p>
              ) : null}
              {state.camera === "error" ? (
                <div className="camera-error" data-testid="camera-error" data-kind={state.error} role="alert">
                  <strong>{ERROR_TEXT[state.error].title}</strong>
                  <span>{ERROR_TEXT[state.error].fix}</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
        {state.camera === "on" && effectsStillOn.length > 0 && (
          <div className="effects-warning" data-testid="camera-effects-warning" role="status">
            <strong>Camera effects are on: {effectsStillOn.join(", ")}.</strong>
            <span>
              The operating system applies them before tracking sees the image: blur smears fingertips,
              framing moves a still hand. {EFFECTS_FIX}
            </span>
          </div>
        )}
        <GesturePanel store={gestureStore} cameraOn={state.camera === "on"} />
        <DetectionPanel
          store={detectionStore}
          renderLatency={renderLatency}
          cameraOn={state.camera === "on"}
        />
      </div>

      <div className="tracking-side">
        <button type="button" className="primary" data-testid="camera-toggle" onClick={toggle}>
          {running ? "Stop camera" : "Start camera"}
        </button>
        <label className="field">
          <span>Camera</span>
          <select
            data-testid="camera-select"
            value={prefs.deviceId}
            onChange={(e) => choosePrefs({ deviceId: e.target.value, mirrored: mirroredFor(e.target.value) })}
          >
            <option value="">System default</option>
            {cameras
              .filter((c) => c.deviceId !== "" && c.deviceId !== "default")
              .map((c, i) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || `Camera ${i + 1}`}
                </option>
              ))}
          </select>
        </label>
        <div className="check-group">
          <label className="check">
            <input
              type="checkbox"
              data-testid="camera-mirrored"
              checked={prefs.mirrored}
              onChange={(e) => choosePrefs({ ...prefs, mirrored: e.target.checked })}
            />
            Camera image is mirrored
          </label>
          <p className="readout-note">
            Raise your right hand: the Gestures card should list it as the right hand. If it says left, your
            camera (often a phone webcam app) sends a mirrored image; tick this.
          </p>
        </div>
        <label className="check">
          <input type="checkbox" checked={debugView} onChange={(e) => setDebugView(e.target.checked)} />
          Debug view
        </label>
        <label className="check">
          <input
            type="checkbox"
            data-testid="show-raw"
            checked={showRaw}
            disabled={!debugView}
            onChange={(e) => setShowRaw(e.target.checked)}
          />
          Show raw points (before smoothing)
        </label>
        {import.meta.env.DEV && (
          <button
            type="button"
            className="secondary"
            data-testid="record-landmarks"
            disabled={state.camera !== "on"}
            onClick={toggleRecording}
          >
            {recording ? "Stop and save landmarks" : "Record landmarks"}
          </button>
        )}

        <dl className="readouts">
          <div>
            <dt>Frame rate</dt>
            <dd data-testid="hud-fps">{stats?.fps ? `${stats.fps.toFixed(0)} fps` : "-"}</dd>
          </div>
          <div>
            <dt>Inference</dt>
            <dd data-testid="hud-inference">{stats ? `${stats.inferenceMs.toFixed(1)} ms` : "-"}</dd>
          </div>
          <div>
            <dt>Camera delivers</dt>
            <dd data-testid="hud-camera">{state.camera === "on" ? cameraLabel(cameraInfo) : "-"}</dd>
          </div>
          <div>
            <dt>Backend</dt>
            <dd data-testid="hud-backend">{backend ?? "-"}</dd>
          </div>
          <div>
            <dt>Camera effects</dt>
            <dd data-testid="hud-camera-effects">{state.camera === "on" ? effectsText : "-"}</dd>
            {state.camera === "on" && effectsText === "not reported" && (
              <p className="readout-note">
                This browser does not report blur, framing or eye contact. If Windows Studio Effects are on:{" "}
                {EFFECTS_FIX}
              </p>
            )}
          </div>
          <div>
            <dt>Face tracking</dt>
            <dd data-testid="hud-face-cadence">{faceCadenceLabel(state, stats)}</dd>
          </div>
          <div>
            <dt>Head yaw / pitch / roll</dt>
            <dd data-testid="hud-head">
              {headPose
                ? `${headPose.headPose.yaw.toFixed(0)}° / ${headPose.headPose.pitch.toFixed(0)}° / ${headPose.headPose.roll.toFixed(0)}°`
                : "-"}
            </dd>
          </div>
          <div>
            <dt>Frames / dropped</dt>
            <dd data-testid="hud-frames">{stats ? `${stats.frames} / ${stats.dropped}` : "-"}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
