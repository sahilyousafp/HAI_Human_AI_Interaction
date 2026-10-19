import { DEFAULT_GESTURES, type PinchReading } from "@aex/perception";
import type { Hand } from "@aex/protocol";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { LatencyTracker } from "../viewer/latency.ts";
import {
  DETECTION_WINDOW_MS,
  type DetectionSample,
  type DetectionStore,
  type StripSegment,
  stripSegments,
  type Track,
} from "./detection-store.ts";

/** The pinch meter spans distance / hand size 0..METER_MAX; open hands read about 1.2 and simply fill it. */
const METER_MAX = 0.5;
const PRESS = DEFAULT_GESTURES.pinch.press;
const RELEASE = DEFAULT_GESTURES.pinch.release;

function readStripColors(el: Element): Record<StripSegment["kind"], string> {
  const css = getComputedStyle(el);
  return {
    seen: css.getPropertyValue("--strip-seen").trim(),
    pinched: css.getPropertyValue("--accent").trim(),
    dropped: css.getPropertyValue("--strip-dropped").trim(),
  };
}

/** The last few seconds of frames for one track, placed by capture time so gaps show as gaps. */
function Strip({
  samples,
  latestTs,
  track,
  label,
}: {
  samples: DetectionSample[];
  latestTs: number | null;
  track: Track;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    if (latestTs === null) return;
    const colors = readStripColors(canvas);
    const start = latestTs - DETECTION_WINDOW_MS;
    const x = (ts: number) => ((ts - start) / DETECTION_WINDOW_MS) * width;
    for (const segment of stripSegments(samples, track)) {
      ctx.fillStyle = colors[segment.kind];
      const left = Math.floor(x(segment.from));
      ctx.fillRect(left, 0, Math.max(1, Math.ceil(x(segment.to)) - left), height);
    }
  }, [samples, latestTs, track]);
  return <canvas ref={ref} className="strip" role="img" aria-label={label} />;
}

const TRACKS: Array<{ track: Track; label: string; testId: string }> = [
  { track: "left", label: "Left hand", testId: "detect-left" },
  { track: "right", label: "Right hand", testId: "detect-right" },
  { track: "face", label: "Face", testId: "detect-face" },
];

const percent = (rate: number | null) => (rate === null ? "-" : `${Math.round(rate * 100)}%`);
const ms = (value: number | null) => (value === null ? "-" : `${Math.round(value)} ms`);

function pinchState(reading: PinchReading | undefined): "touch" | "curled" | "apart" | "none" {
  if (!reading) return "none";
  if (reading.ratio >= PRESS) return "apart";
  return reading.othersOpen ? "touch" : "curled";
}

const STATE_TEXT = { touch: "touching", curled: "fingers curled", apart: "apart", none: "no hand" } as const;

function PinchMeter({ hand, reading }: { hand: Hand; reading: PinchReading | undefined }) {
  const state = pinchState(reading);
  const fill = reading ? Math.min(1, reading.ratio / METER_MAX) : 0;
  const side = hand.toLowerCase();
  return (
    <div className="pinch-row" data-testid={`pinch-${side}`} data-state={state}>
      <span className="detection-label">{hand}</span>
      {/* The bar is a picture of the number beside it; screen readers get the number and the state. */}
      <div className="pinch-meter" aria-hidden="true">
        {reading && <span className="pinch-fill" style={{ width: `${fill * 100}%` }} />}
        <span className="pinch-mark" style={{ left: `${(PRESS / METER_MAX) * 100}%` }} />
        <span className="pinch-mark release" style={{ left: `${(RELEASE / METER_MAX) * 100}%` }} />
      </div>
      <span className="detection-value" data-testid={`pinch-${side}-ratio`}>
        {reading ? reading.ratio.toFixed(2) : "-"}
        <span className="visually-hidden">, {STATE_TEXT[state]}</span>
      </span>
    </div>
  );
}

/**
 * Tracking reliability and response at a glance: detection rate per hand and face with a strip of recent frames,
 * a live pinch meter per hand, pinches recognised, and the camera-to-gesture and gesture-to-render latency.
 */
export function DetectionPanel({
  store,
  renderLatency,
  cameraOn,
}: {
  store: DetectionStore;
  renderLatency: LatencyTracker;
  cameraOn: boolean;
}) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { taps, drags, twoHand } = snap.counts;

  return (
    <section className="detection" aria-label="Detection">
      <header className="detection-head">
        <h2>Detection</h2>
        <span className="muted">last {DETECTION_WINDOW_MS / 1000} s</span>
      </header>

      <div className="detection-rows">
        {TRACKS.map(({ track, label, testId }) => (
          <div className="detection-row" key={track}>
            <span className="detection-label">{label}</span>
            <Strip
              samples={snap.samples}
              latestTs={snap.latestTs}
              track={track}
              label={`${label} per frame`}
            />
            <span className="detection-value" data-testid={testId}>
              {cameraOn ? percent(snap.rates[track]) : "-"}
            </span>
          </div>
        ))}
      </div>
      <p className="detection-legend">
        <span className="swatch seen" /> found <span className="swatch pinched" /> pinching{" "}
        <span className="swatch dropped" /> dropped by tracking
      </p>

      <div className="detection-rows">
        <PinchMeter hand="Left" reading={cameraOn ? snap.pinch.Left : undefined} />
        <PinchMeter hand="Right" reading={cameraOn ? snap.pinch.Right : undefined} />
      </div>
      <p className="detection-legend">
        Thumb to index distance. Left of the first mark the tips <span className="key touch">touch</span> and
        a pinch starts; past the second it ends. <span className="key curled">Amber</span>: the other fingers
        are curled, which is a fist, not a pinch.
      </p>

      <dl className="detection-stats">
        <div>
          <dt>Taps / drags / two-hand</dt>
          <dd data-testid="detect-pinches">{cameraOn ? `${taps} / ${drags} / ${twoHand}` : "-"}</dd>
        </div>
        <div>
          <dt>Camera to gesture p90</dt>
          <dd data-testid="detect-camera-to-gesture">{cameraOn ? ms(snap.cameraToGestureP90) : "-"}</dd>
        </div>
        <div>
          <dt>Gesture to render p90</dt>
          <dd data-testid="detect-gesture-to-render">{ms(renderLatency.p90())}</dd>
        </div>
      </dl>
    </section>
  );
}
