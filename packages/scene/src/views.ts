import type { ViewMode } from "@hai/protocol";

/** The ways the viewer looks at the model: the turntable perspective, and six true orthographic views. */
export { VIEW_MODES, type ViewMode } from "@hai/protocol";
export type OrthoView = Exclude<ViewMode, "perspective">;

/** The plane a point is drawn in: plan, or a vertical plane (x with z, or y with z). */
export type WorkPlane = "xy" | "xz" | "yz";

/**
 * Where each orthographic view puts the turntable camera (degrees) and which plane its points lie in. The camera sits
 * on the named side looking at the model: Front from -Y with X to the right, Right from +X with Y to the right, Top from
 * above with north up. The elevation of Top and Bottom stops a hair short of 90 so the up axis stays defined.
 */
export const ORTHO_VIEWS: Record<OrthoView, { azimuth: number; elevation: number; plane: WorkPlane }> = {
  top: { azimuth: 270, elevation: 89.99, plane: "xy" },
  bottom: { azimuth: 270, elevation: -89.99, plane: "xy" },
  front: { azimuth: 270, elevation: 0, plane: "xz" },
  back: { azimuth: 90, elevation: 0, plane: "xz" },
  right: { azimuth: 0, elevation: 0, plane: "yz" },
  left: { azimuth: 180, elevation: 0, plane: "yz" },
};

const ANGLE_TOLERANCE = 0.05;

/** Whether a camera still looks the way an orthographic view puts it (panning and zooming keep that; orbiting breaks it). */
export function viewMatches(mode: ViewMode, camera: { azimuth: number; elevation: number }): boolean {
  if (mode === "perspective") return true;
  const view = ORTHO_VIEWS[mode];
  // The angle between the two azimuths, 0 to 180.
  const apart = Math.abs(((camera.azimuth - view.azimuth + 540) % 360) - 180);
  return Math.abs(camera.elevation - view.elevation) <= ANGLE_TOLERANCE && apart <= ANGLE_TOLERANCE;
}

/** The plane points are drawn in for a view: plan for the perspective and for Top and Bottom. */
export function workPlane(mode: ViewMode): WorkPlane {
  return mode === "perspective" ? "xy" : ORTHO_VIEWS[mode].plane;
}
