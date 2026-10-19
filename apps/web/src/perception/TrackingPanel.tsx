import type { TrackingFrame } from "@aex/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { type DrawColors, drawTracking } from "./draw.ts";
import { type CameraError, Tracker, type TrackerState, type TrackerStats } from "./tracker.ts";

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
  };
}

function faceCadenceLabel(state: TrackerState, stats: TrackerStats | null): string {
  if (state.camera !== "on") return "-";
  return stats?.faceCadence === 2 ? "every 2nd frame" : "every frame";
}

export function TrackingPanel({ onCameraState }: { onCameraState(state: TrackerState): void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<Tracker | null>(null);
  const latestFrame = useRef<TrackingFrame | null>(null);
  const latestStats = useRef<TrackerStats | null>(null);
  const [state, setState] = useState<TrackerState>({ camera: "off" });
  const [stats, setStats] = useState<TrackerStats | null>(null);
  const [headPose, setHeadPose] = useState<TrackingFrame["face"] | null>(null);
  const [handCount, setHandCount] = useState(0);
  const [debugView, setDebugView] = useState(true);

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
        onFrame: (frame, frameStats, faceRan) => {
          latestFrame.current = frame;
          latestStats.current = frameStats;
          if (import.meta.env.DEV) {
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
    return () => tracker.stop();
  }, [updateState]);

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
      drawTracking(ctx, debugView ? latestFrame.current : null, colors);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      scheme.removeEventListener("change", refreshColors);
    };
  }, [debugView]);

  // Text readouts refresh once per second.
  useEffect(() => {
    const id = setInterval(() => {
      setStats(latestStats.current ? { ...latestStats.current } : null);
      setHeadPose(latestFrame.current?.face ?? null);
      setHandCount(latestFrame.current?.hands.length ?? 0);
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
    } else {
      void trackerRef.current?.start();
    }
  };

  const backend = state.camera === "on" ? state.backend : null;

  return (
    <section className="tracking" aria-label="Camera tracking">
      <div className="preview" data-camera={state.camera}>
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

      <div className="tracking-side">
        <button type="button" className="primary" data-testid="camera-toggle" onClick={toggle}>
          {running ? "Stop camera" : "Start camera"}
        </button>
        <label className="check">
          <input type="checkbox" checked={debugView} onChange={(e) => setDebugView(e.target.checked)} />
          Debug view
        </label>

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
            <dt>Backend</dt>
            <dd data-testid="hud-backend">{backend ?? "-"}</dd>
          </div>
          <div>
            <dt>Hands</dt>
            <dd data-testid="hud-hands">{state.camera === "on" ? handCount : "-"}</dd>
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
