/** A turntable camera around the world Z axis (Z up, like Rhino). Lengths are metres in the viewer. */
export interface Turntable {
  target: [number, number, number];
  /** Degrees around Z, measured from +X toward +Y. */
  azimuth: number;
  /** Degrees above the ground plane. */
  elevation: number;
  /** Camera distance from the target, metres. */
  distance: number;
}

export const ELEVATION_MIN = 5;
export const ELEVATION_MAX = 89;
export const DISTANCE_MIN = 2;
export const DISTANCE_MAX = 2000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rad = (deg: number) => (deg * Math.PI) / 180;

export function orbit(t: Turntable, dAzimuth: number, dElevation: number): Turntable {
  return {
    ...t,
    azimuth: (((t.azimuth + dAzimuth) % 360) + 360) % 360,
    elevation: clamp(t.elevation + dElevation, ELEVATION_MIN, ELEVATION_MAX),
  };
}

/** factor < 1 moves closer. */
export function zoom(t: Turntable, factor: number): Turntable {
  return { ...t, distance: clamp(t.distance * factor, DISTANCE_MIN, DISTANCE_MAX) };
}

/** Camera position for a turntable state. */
export function cameraPosition(t: Turntable): [number, number, number] {
  const az = rad(t.azimuth);
  const el = rad(t.elevation);
  const flat = t.distance * Math.cos(el);
  return [
    t.target[0] + flat * Math.cos(az),
    t.target[1] + flat * Math.sin(az),
    t.target[2] + t.distance * Math.sin(el),
  ];
}

/**
 * Moves the target parallel to the screen. dx, dy are fractions of the view height (right and up positive),
 * so a pan of 1 moves the scene by about one view height at the target, whatever the zoom.
 */
export function pan(t: Turntable, dx: number, dy: number, fovDeg = 45): Turntable {
  const viewHeight = 2 * t.distance * Math.tan(rad(fovDeg) / 2);
  const az = rad(t.azimuth);
  const el = rad(t.elevation);
  // Screen right is perpendicular to the view direction in the ground plane; screen up tilts with elevation.
  const right: [number, number, number] = [-Math.sin(az), Math.cos(az), 0];
  const up: [number, number, number] = [
    -Math.sin(el) * Math.cos(az),
    -Math.sin(el) * Math.sin(az),
    Math.cos(el),
  ];
  const sx = -dx * viewHeight;
  const sy = -dy * viewHeight;
  return {
    ...t,
    target: [
      t.target[0] + right[0] * sx + up[0] * sy,
      t.target[1] + right[1] * sx + up[1] * sy,
      t.target[2] + right[2] * sx + up[2] * sy,
    ],
  };
}

/** A view that frames a bounding box (metres) from the south-east, slightly above. */
export function frameBox(min: [number, number, number], max: [number, number, number]): Turntable {
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const size = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  return {
    target: center,
    azimuth: 305,
    elevation: 32,
    distance: clamp(size * 1.05, DISTANCE_MIN, DISTANCE_MAX),
  };
}
