import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ToolIcon } from "../tools/ToolOverlays.tsx";
import { CAMERA_EFFECTS, type CameraEffectsState, EFFECT_NAMES } from "./camera-effects.ts";
import { type DrawColors, drawTracking } from "./draw.ts";
import { describeGesture, HAND_LABEL } from "./GesturePanel.tsx";
import { LAST_GESTURE_HOLD_MS } from "./gesture-store.ts";
import type { CameraError } from "./tracker.ts";
import type { TrackingSession } from "./tracking-session.ts";

export const ERROR_TEXT: Record<CameraError, { title: string; fix: string }> = {
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

export const EFFECTS_FIX =
  "Turn them off in Quick settings (Windows+A) > Studio effects, or Settings > Bluetooth & devices > Cameras > your camera.";

export function effectsOn(effects: CameraEffectsState | null): string[] {
  return effects ? CAMERA_EFFECTS.filter((e) => effects[e] === "on").map((e) => EFFECT_NAMES[e]) : [];
}

export function readColors(el: Element): DrawColors {
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

const EXPAND_ICON = "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5";
const SHRINK_ICON = "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5";
const MINIMISE_ICON = "M5 12h14";
const CAMERA_ICON = "M3 7h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";
const EXPANDED_KEY = "hai.previewExpanded";
const MINIMISED_KEY = "hai.cameraMinimised";

/** A remembered view choice in this browser (a convenience; it defaults to off). */
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage blocked (private window): the choice lasts for this page only.
  }
}

const percent = (rate: number | null) => (rate === null ? "-" : `${Math.round(rate * 100)}%`);

/**
 * The camera, floating at the bottom right of the model: the mirrored preview with the tracked points drawn over
 * it, what each hand is doing and how reliably it is found, and the controls to start the camera, enlarge the view
 * or tuck it away. The camera keeps running whatever this view shows.
 */
export function CameraView({ session }: { session: TrackingSession }) {
  const { state, prefs, debugView, showRaw, effects } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const gestures = useSyncExternalStore(session.gestures.subscribe, session.gestures.getSnapshot);
  const detection = useSyncExternalStore(session.detection.subscribe, session.detection.getSnapshot);
  const videoSlot = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [expanded, setExpanded] = useState(() => readFlag(EXPANDED_KEY));
  const [minimised, setMinimised] = useState(() => readFlag(MINIMISED_KEY));
  const expand = (value: boolean) => {
    setExpanded(value);
    writeFlag(EXPANDED_KEY, value);
  };
  const minimise = (value: boolean) => {
    setMinimised(value);
    writeFlag(MINIMISED_KEY, value);
  };

  // The session's own video element is shown here; it keeps playing when this view is tucked away.
  useEffect(() => {
    const slot = videoSlot.current;
    if (!slot || minimised) return;
    slot.prepend(session.video);
    void session.video.play().catch(() => {});
    return () => session.park();
  }, [session, minimised]);

  // Redraw the points every animation frame from the latest result; no React render per frame.
  useEffect(() => {
    if (minimised) return; // tucked away: nothing to draw on
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    let colors = readColors(canvas);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const refresh = () => {
      colors = readColors(canvas);
    };
    scheme.addEventListener("change", refresh);
    const tick = () => {
      drawTracking(ctx, debugView ? session.latestFrame : null, colors, showRaw ? session.latestRaw : []);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      scheme.removeEventListener("change", refresh);
    };
  }, [session, debugView, showRaw, minimised]);

  const running = state.camera === "on" || state.camera === "starting";
  const cameraOn = state.camera === "on";
  const engaged = gestures.state.engaged;
  const last =
    gestures.last && performance.now() - gestures.last.shownAt < LAST_GESTURE_HOLD_MS
      ? gestures.last.event
      : null;
  const hand = (side: "Left" | "Right") => {
    const display = gestures.state.hands[side];
    return display ? HAND_LABEL[display] : "-";
  };
  const effectsStillOn = effectsOn(effects);

  if (minimised) {
    return (
      <button
        type="button"
        className="camera-pill"
        data-testid="camera-restore"
        data-camera={state.camera}
        data-hud
        onClick={() => minimise(false)}
        title="Show the camera"
      >
        <span className="camera-pill-dot" aria-hidden="true" />
        <ToolIcon path={CAMERA_ICON} size={15} />
        Camera
      </button>
    );
  }

  return (
    <section
      className="camera-view"
      data-testid="camera-view"
      data-expanded={expanded}
      data-hud
      aria-label="Camera"
    >
      <div
        className="preview"
        data-testid="camera-preview"
        data-camera={state.camera}
        data-mirrored={prefs.mirrored}
        data-expanded={expanded}
      >
        <div ref={videoSlot} className="preview-media">
          <canvas
            ref={canvasRef}
            className="preview-overlay"
            width={640}
            height={480}
            role="img"
            aria-label="Tracked hand and face points over the camera preview"
          />
        </div>
        {state.camera !== "on" && (
          <div className="preview-empty">
            {state.camera === "starting" && <p>Starting the camera and loading the models...</p>}
            {state.camera === "off" && <p>Video stays in this tab; only hand and face points are used.</p>}
            {state.camera === "error" && (
              <div className="camera-error" data-testid="camera-error" data-kind={state.error} role="alert">
                <strong>{ERROR_TEXT[state.error].title}</strong>
                <span>{ERROR_TEXT[state.error].fix}</span>
              </div>
            )}
          </div>
        )}
        <div className="camera-controls">
          <button
            type="button"
            className="camera-button"
            data-testid="preview-expand"
            aria-pressed={expanded}
            aria-label={expanded ? "Shrink the camera view" : "Expand the camera view"}
            title={expanded ? "Shrink the camera view" : "Expand the camera view"}
            onClick={() => expand(!expanded)}
          >
            <ToolIcon path={expanded ? SHRINK_ICON : EXPAND_ICON} size={15} />
          </button>
          {!expanded && (
            <button
              type="button"
              className="camera-button"
              data-testid="camera-minimise"
              aria-label="Hide the camera view"
              title="Hide the camera view (the camera keeps running)"
              onClick={() => minimise(true)}
            >
              <ToolIcon path={MINIMISE_ICON} size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="camera-bar">
        <button
          type="button"
          className={running ? "camera-start running" : "camera-start"}
          data-testid="camera-toggle"
          onClick={() => session.toggle()}
        >
          {running ? "Stop camera" : "Start camera"}
        </button>
        {cameraOn && (
          <span
            className="camera-chip"
            data-testid="camera-chip-engaged"
            data-state={engaged ? "engaged" : "idle"}
          >
            {engaged ? "Engaged" : "Open palm to engage"}
          </span>
        )}
      </div>
      {cameraOn && (
        <dl className="camera-readouts">
          <div data-hand="left">
            <dt>Left</dt>
            <dd>
              {hand("Left")} <span className="muted">{percent(detection.rates.left)}</span>
            </dd>
          </div>
          <div data-hand="right">
            <dt>Right</dt>
            <dd>
              {hand("Right")} <span className="muted">{percent(detection.rates.right)}</span>
            </dd>
          </div>
          <div className="camera-last">
            <dt>Last</dt>
            <dd data-testid="camera-last-gesture">{last ? describeGesture(last) : "-"}</dd>
          </div>
        </dl>
      )}
      {cameraOn && effectsStillOn.length > 0 && (
        <p className="effects-warning" data-testid="camera-effects-warning" role="status">
          <strong>Camera effects are on: {effectsStillOn.join(", ")}.</strong> {EFFECTS_FIX}
        </p>
      )}
    </section>
  );
}
