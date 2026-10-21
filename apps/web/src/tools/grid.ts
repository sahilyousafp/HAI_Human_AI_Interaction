/** Move, Copy and the create tools snap to this grid, millimetres. */
export const SNAP_MM = 100;

export const snap = (mm: number, step = SNAP_MM): number => Math.round(mm / step) * step;
