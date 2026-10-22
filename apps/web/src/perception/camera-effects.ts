/**
 * Camera effects applied by the operating system before the browser sees a frame (Windows Studio Effects on laptops
 * with an NPU, macOS and ChromeOS video effects). All of them hurt hand tracking: background blur smears fingertips
 * that leave the body's outline and can fill the gap between thumb and index, automatic framing crops and pans the
 * image so a still hand appears to move, and eye contact correction warps the face that head pose is read from.
 *
 * Chromium exposes them as track constraints (w3c mediacapture-extensions), on Windows controllable, elsewhere
 * read-only; some browser builds only behind experimental web platform features.
 */
export const CAMERA_EFFECTS = ["backgroundBlur", "faceFraming", "eyeGazeCorrection"] as const;
export type CameraEffect = (typeof CAMERA_EFFECTS)[number];

export const EFFECT_NAMES: Record<CameraEffect, string> = {
  backgroundBlur: "background blur",
  faceFraming: "automatic framing",
  eyeGazeCorrection: "eye contact",
};

/** Per effect: off, on (and the browser could not turn it off), or not reported by this browser. */
export type CameraEffectsState = Record<CameraEffect, "off" | "on" | "unknown">;

type EffectSettings = Partial<Record<CameraEffect, boolean>>;
type EffectCapabilities = Partial<Record<CameraEffect, boolean[]>>;

/** Constraints that ask for every effect off; browsers that do not know a constraint ignore it. */
export const EFFECTS_OFF: EffectSettings = {
  backgroundBlur: false,
  faceFraming: false,
  eyeGazeCorrection: false,
};

export function readEffects(track: MediaStreamTrack): CameraEffectsState {
  const settings = track.getSettings() as EffectSettings;
  const state = {} as CameraEffectsState;
  for (const effect of CAMERA_EFFECTS) {
    const value = settings[effect];
    state[effect] = value === undefined ? "unknown" : value ? "on" : "off";
  }
  return state;
}

/** Turns off every effect the browser lets the page control, then reports what is left. */
export async function disableEffects(track: MediaStreamTrack): Promise<CameraEffectsState> {
  const capabilities = track.getCapabilities() as EffectCapabilities;
  const settings = track.getSettings() as EffectSettings;
  const off: EffectSettings = {};
  for (const effect of CAMERA_EFFECTS) {
    if (settings[effect] && capabilities[effect]?.includes(false)) off[effect] = false;
  }
  if (Object.keys(off).length > 0) {
    try {
      await track.applyConstraints({ ...track.getConstraints(), ...off } as MediaTrackConstraints);
    } catch (error) {
      console.warn("[hai] could not turn off camera effects:", error);
    }
  }
  return readEffects(track);
}
