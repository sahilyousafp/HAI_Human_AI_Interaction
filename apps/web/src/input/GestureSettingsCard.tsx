import {
  ACTION_LABELS,
  BINDING_KEYS,
  type BindingKey,
  bindingKey,
  DEFAULT_BINDINGS,
  GESTURE_SLOT_IDS,
  GESTURE_SLOTS,
  type GestureAction,
  type GestureBindings,
  type GestureSlot,
  type GestureType,
  type Hand,
} from "@aex/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { GestureSettings } from "./gesture-settings.ts";
import type { InputBus } from "./input-bus.ts";

/** How long a row stays lit after its gesture is detected. */
const LIT_MS = 1200;

/** The gesture event that shows each row was just detected. */
const DETECTED_BY: Partial<Record<GestureType, GestureSlot | "engage">> = {
  engaged: "engage",
  "pinch.tap": "tap",
  "pinch.hold": "hold",
  "pinch.drag.start": "drag",
  "twohand.start": "twohand",
  "clutch.start": "fist",
  "fist.drag.start": "fistdrag",
  "head.nod": "nod",
  "head.shake": "shake",
  "hands.stop": "stop",
};

/** One gesture's dropdown of the actions it can take, for one hand or for both. */
function ActionSelect({
  id,
  slot,
  bindingId,
  bindings,
  settings,
  label,
}: {
  id: string;
  slot: GestureSlot;
  bindingId: BindingKey;
  bindings: GestureBindings;
  settings: GestureSettings;
  label?: string;
}) {
  return (
    <select
      id={id}
      data-testid={id}
      aria-label={label}
      value={bindings[bindingId]}
      onChange={(e) => settings.set(bindingId, e.target.value as GestureAction)}
    >
      {GESTURE_SLOTS[slot].actions.map((action) => (
        <option key={action} value={action}>
          {ACTION_LABELS[action]}
          {action === DEFAULT_BINDINGS[bindingId] ? " (default)" : ""}
        </option>
      ))}
    </select>
  );
}

/**
 * Settings: every gesture the app recognises, how to make it, and what it does, each changeable from a dropdown of
 * the actions that gesture can take; one-hand gestures have one for each hand. A row lights up when its gesture is
 * detected, so trying a gesture shows whether the camera sees it.
 */
export function GestureSettingsCard({ settings, bus }: { settings: GestureSettings; bus: InputBus }) {
  const bindings = useSyncExternalStore(settings.subscribe, settings.getSnapshot);
  const [lit, setLit] = useState<{ slot: GestureSlot | "engage"; at: number } | null>(null);
  const changed = BINDING_KEYS.some((key) => bindings[key] !== DEFAULT_BINDINGS[key]);

  useEffect(
    () =>
      bus.onGestures((events) => {
        for (const event of events) {
          const slot = DETECTED_BY[event.type];
          if (slot) setLit({ slot, at: Date.now() });
        }
      }),
    [bus],
  );
  useEffect(() => {
    if (!lit) return;
    const id = setTimeout(() => setLit(null), LIT_MS);
    return () => clearTimeout(id);
  }, [lit]);

  const isLit = (slot: GestureSlot | "engage") => lit?.slot === slot;
  return (
    <section
      className="palette-settings gesture-settings"
      data-testid="gesture-settings"
      aria-label="Gestures"
    >
      <header className="detection-head">
        <h2>Gestures</h2>
        <span className="muted">what each one does</span>
      </header>
      <ul className="gesture-rows">
        <li className="gesture-row" data-slot="engage" data-lit={isLit("engage")}>
          <div className="gesture-what">
            <span className="gesture-name">Open palm</span>
            <span className="muted">Hold an open palm toward the camera</span>
          </div>
          <span className="gesture-fixed">Engage (always)</span>
        </li>
        {GESTURE_SLOT_IDS.map((slot) => {
          const { label, how, perHand } = GESTURE_SLOTS[slot];
          const id = `gesture-${slot}`;
          return (
            <li key={slot} className="gesture-row" data-slot={slot} data-lit={isLit(slot)}>
              <div className="gesture-what">
                {perHand ? (
                  <span className="gesture-name">{label}</span>
                ) : (
                  <label className="gesture-name" htmlFor={id}>
                    {label}
                  </label>
                )}
                <span className="muted">{how}</span>
              </div>
              {perHand ? (
                <div className="gesture-hands">
                  {(["Left", "Right"] as const).map((hand: Hand) => (
                    <div key={hand} className="gesture-hand" data-hand={hand.toLowerCase()}>
                      <label htmlFor={`${id}-${hand.toLowerCase()}`}>{hand}</label>
                      <ActionSelect
                        id={`${id}-${hand.toLowerCase()}`}
                        slot={slot}
                        bindingId={bindingKey(slot, hand)}
                        bindings={bindings}
                        settings={settings}
                        label={`${label}, ${hand.toLowerCase()} hand`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <ActionSelect
                  id={id}
                  slot={slot}
                  bindingId={bindingKey(slot)}
                  bindings={bindings}
                  settings={settings}
                />
              )}
            </li>
          );
        })}
      </ul>
      <p className="muted gesture-note">
        Try a gesture: its row lights up when the camera sees it. Thresholds are in docs/gestures.md.
      </p>
      <button type="button" className="secondary" disabled={!changed} onClick={() => settings.reset()}>
        Reset to defaults
      </button>
    </section>
  );
}
