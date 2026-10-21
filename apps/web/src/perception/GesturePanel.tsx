import type { HandDisplay } from "@aex/perception";
import type { GestureEvent } from "@aex/protocol";
import { useSyncExternalStore } from "react";
import { type GestureStore, LAST_GESTURE_HOLD_MS } from "./gesture-store.ts";

export const HAND_LABEL: Record<HandDisplay, string> = {
  idle: "relaxed",
  "open-palm": "open palm",
  pinch: "pinch",
  drag: "drag",
  clutch: "clutch (fist)",
};

const EVENT_LABEL: Partial<Record<GestureEvent["type"], string>> = {
  engaged: "engaged",
  disengaged: "disengaged",
  "pinch.tap": "tap",
  "pinch.drag.start": "drag start",
  "pinch.drag.end": "drag end",
  "clutch.start": "clutch",
  "clutch.end": "clutch released",
  "twohand.start": "two-hand start",
  "twohand.end": "two-hand end",
  "head.nod": "nod",
  "head.shake": "shake",
  "hands.stop": "stop (fists, then open hands)",
};

/** A gesture as the HUD names it, with its hand: "tap (left)". */
export function describeGesture(event: GestureEvent): string {
  const label = EVENT_LABEL[event.type] ?? event.type;
  return "hand" in event && event.hand !== "both" ? `${label} (${event.hand.toLowerCase()})` : label;
}

export function GesturePanel({ store, cameraOn }: { store: GestureStore; cameraOn: boolean }) {
  const { state, last, gestureMs } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const lastVisible = last && performance.now() - last.shownAt < LAST_GESTURE_HOLD_MS ? last.event : null;
  // Capture timestamps are epoch ms (performance.timeOrigin based), so they compare with "now" directly.
  const now = performance.timeOrigin + performance.now();
  const head =
    state.lastHead && now - state.lastHead.ts < LAST_GESTURE_HOLD_MS
      ? EVENT_LABEL[state.lastHead.type]
      : null;
  const hand = (side: "Left" | "Right") => {
    const display = state.hands[side];
    return display ? HAND_LABEL[display] : "-";
  };

  return (
    <section className="gestures" aria-label="Gestures">
      <div className="gestures-head">
        <span
          className="gesture-pill"
          data-testid="hud-engaged"
          data-state={state.engaged ? "engaged" : "idle"}
        >
          {state.engaged ? "Engaged" : "Not engaged"}
        </span>
        {state.twoHand && <span className="gesture-pill two">Two hands</span>}
        {state.stopArmed && (
          <span className="gesture-pill stop" data-testid="hud-stop-armed">
            Open both hands to stop
          </span>
        )}
      </div>
      {cameraOn && !state.engaged && (
        <p className="gesture-hint">Hold an open palm toward the camera to engage.</p>
      )}
      <dl className="readouts">
        <div>
          <dt>Left hand</dt>
          <dd data-testid="hud-hand-left">{hand("Left")}</dd>
        </div>
        <div>
          <dt>Right hand</dt>
          <dd data-testid="hud-hand-right">{hand("Right")}</dd>
        </div>
        <div>
          <dt>Head</dt>
          <dd data-testid="hud-head-gesture">{head ?? "-"}</dd>
        </div>
        <div>
          <dt>Last gesture</dt>
          <dd data-testid="hud-last-gesture">{lastVisible ? describeGesture(lastVisible) : "-"}</dd>
        </div>
        <div>
          <dt>Recogniser</dt>
          <dd data-testid="hud-gesture-ms">{cameraOn ? `${gestureMs.toFixed(2)} ms` : "-"}</dd>
        </div>
      </dl>
    </section>
  );
}
