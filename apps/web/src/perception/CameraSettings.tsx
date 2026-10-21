import type { TrackingFrame } from "@aex/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ListGroup, ListRow, Switch } from "../ui/controls.tsx";
import type { LatencyTracker } from "../viewer/latency.ts";
import { EFFECTS_FIX, effectsOn } from "./CameraView.tsx";
import { CAMERA_EFFECTS, type CameraEffectsState } from "./camera-effects.ts";
import { mirroredFor } from "./camera-prefs.ts";
import { DetectionPanel } from "./DetectionPanel.tsx";
import { GesturePanel } from "./GesturePanel.tsx";
import type { CameraInfo, TrackerState, TrackerStats } from "./tracker.ts";
import type { TrackingSession } from "./tracking-session.ts";

async function listCameras(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}

function effectsLabel(effects: CameraEffectsState | null): string {
  if (!effects) return "-";
  const on = effectsOn(effects);
  if (on.length > 0) return on.join(", ");
  return CAMERA_EFFECTS.every((e) => effects[e] === "off") ? "off" : "not reported";
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

/**
 * Settings > Camera and tracking: which camera and how its image comes in, what is drawn over the preview, what
 * the tracker sees right now (the Gestures and Detection cards), and how fast it runs.
 */
export function CameraSettings({
  session,
  renderLatency,
}: {
  session: TrackingSession;
  renderLatency: LatencyTracker;
}) {
  const { state, prefs, debugView, showRaw, effects, cameraInfo, recording } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [stats, setStats] = useState<TrackerStats | null>(null);
  const [face, setFace] = useState<TrackingFrame["face"] | null>(null);
  const cameraOn = state.camera === "on";

  // The camera list; names are only readable once camera permission is granted, so refresh when the camera starts.
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const refresh = () => void listCameras().then(setCameras);
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, []);
  useEffect(() => {
    if (cameraOn) void listCameras().then(setCameras);
  }, [cameraOn]);

  // Text readouts refresh once per second.
  useEffect(() => {
    const id = setInterval(() => {
      setStats(session.latestStats ? { ...session.latestStats } : null);
      setFace(session.latestFrame?.face ?? null);
    }, 1000);
    return () => clearInterval(id);
  }, [session]);

  const backend = state.camera === "on" ? state.backend : null;
  const effectsText = effectsLabel(effects);

  return (
    <div className="settings-page-body" data-testid="camera-settings">
      <ListGroup
        title="Camera"
        footer="Raise your right hand: Tracking below should list it as the right hand. If it says left, your camera (often a phone webcam app) sends a mirrored image; turn on Mirrored."
      >
        <ListRow
          label="Camera"
          htmlFor="camera-select"
          control={
            <select
              id="camera-select"
              className="list-select"
              data-testid="camera-select"
              value={prefs.deviceId}
              onChange={(e) =>
                session.setPrefs({ deviceId: e.target.value, mirrored: mirroredFor(e.target.value) })
              }
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
          }
        />
        <ListRow
          label="Camera image is mirrored"
          control={
            <Switch
              label="Camera image is mirrored"
              testId="camera-mirrored"
              checked={prefs.mirrored}
              onChange={(mirrored) => session.setPrefs({ ...prefs, mirrored })}
            />
          }
        />
      </ListGroup>

      <ListGroup title="Preview">
        <ListRow
          label="Show tracked points"
          control={
            <Switch
              label="Show tracked points"
              testId="debug-view"
              checked={debugView}
              onChange={(on) => session.setDebugView(on)}
            />
          }
        />
        <ListRow
          label="Show raw points"
          detail="Before smoothing"
          control={
            <Switch
              label="Show raw points"
              testId="show-raw"
              checked={showRaw}
              disabled={!debugView}
              onChange={(on) => session.setShowRaw(on)}
            />
          }
        />
        {import.meta.env.DEV && (
          <ListRow
            label="Record landmarks"
            detail="Dev builds: saves a fixture file"
            control={
              <button
                type="button"
                className="secondary"
                data-testid="record-landmarks"
                disabled={!cameraOn}
                onClick={() => session.toggleRecording()}
              >
                {recording ? "Stop and save" : "Record"}
              </button>
            }
          />
        )}
      </ListGroup>

      <h3 className="list-group-title">Tracking</h3>
      <div className="settings-card">
        <GesturePanel store={session.gestures} cameraOn={cameraOn} />
      </div>
      <div className="settings-card">
        <DetectionPanel store={session.detection} renderLatency={renderLatency} cameraOn={cameraOn} />
      </div>

      <h3 className="list-group-title">Performance</h3>
      <dl className="readouts settings-card">
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
          <dd data-testid="hud-camera">{cameraOn ? cameraLabel(cameraInfo) : "-"}</dd>
        </div>
        <div>
          <dt>Backend</dt>
          <dd data-testid="hud-backend">{backend ?? "-"}</dd>
        </div>
        <div>
          <dt>Camera effects</dt>
          <dd data-testid="hud-camera-effects">{cameraOn ? effectsText : "-"}</dd>
          {cameraOn && effectsText === "not reported" && (
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
            {face
              ? `${face.headPose.yaw.toFixed(0)}° / ${face.headPose.pitch.toFixed(0)}° / ${face.headPose.roll.toFixed(0)}°`
              : "-"}
          </dd>
        </div>
        <div>
          <dt>Frames / dropped</dt>
          <dd data-testid="hud-frames">{stats ? `${stats.frames} / ${stats.dropped}` : "-"}</dd>
        </div>
      </dl>
    </div>
  );
}
