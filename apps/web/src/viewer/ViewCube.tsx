import type { OrthoView, ViewMode } from "@hai/scene";
import { type MutableRefObject, useEffect, useRef } from "react";

type V3 = [number, number, number];

/** A face of the cube: the view it picks, the way it faces (in the world) and which way up its label reads. */
const FACES: ReadonlyArray<{ id: OrthoView; label: string; normal: V3; up: V3 }> = [
  { id: "top", label: "Top", normal: [0, 0, 1], up: [0, 1, 0] },
  { id: "bottom", label: "Bottom", normal: [0, 0, -1], up: [0, -1, 0] },
  { id: "front", label: "Front", normal: [0, -1, 0], up: [0, 0, 1] },
  { id: "back", label: "Back", normal: [0, 1, 0], up: [0, 0, 1] },
  { id: "right", label: "Right", normal: [1, 0, 0], up: [0, 0, 1] },
  { id: "left", label: "Left", normal: [-1, 0, 0], up: [0, 0, 1] },
];

/** The cube's edge, px. */
const SIZE = 52;
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * The CSS transform of every face for a camera looking at the model from `azimuth` and `elevation` (degrees): the world
 * is turned into the screen's axes (x right, y down, z towards the viewer) with the camera's right, up and forward
 * vectors, and each face keeps its own right and down so its label reads. Faces turned away are hidden by the browser.
 */
export function faceTransforms(azimuth: number, elevation: number): string[] {
  const [sa, ca, se, ce] = [
    Math.sin(rad(azimuth)),
    Math.cos(rad(azimuth)),
    Math.sin(rad(elevation)),
    Math.cos(rad(elevation)),
  ];
  const right: V3 = [-sa, ca, 0];
  const up: V3 = [-se * ca, -se * sa, ce];
  const forward: V3 = [-ce * ca, -ce * sa, -se];
  const toScreen = (w: V3): V3 => [dot(w, right), -dot(w, up), -dot(w, forward)];
  return FACES.map(({ normal, up: faceUp }) => {
    const [a, b, c] = [
      toScreen(cross(faceUp, normal)),
      toScreen(faceUp.map((v) => -v) as V3),
      toScreen(normal),
    ];
    const t = toScreen(normal).map((v) => v * (SIZE / 2)) as V3;
    return `matrix3d(${[...a, 0, ...b, 0, ...c, 0, ...t, 1].map((v) => v.toFixed(4)).join(",")})`;
  });
}

/**
 * The view cube, at the viewport's right: a cube that turns with the camera so it always shows where Top, Front and
 * Right are, and whose faces are the orthographic views (a press on a face goes there). Perspective returns to the
 * turntable camera. `cubeRef` is how the viewer's camera tells the cube where it looks, every frame, without a render.
 */
export function ViewCube({
  mode,
  onView,
  cubeRef,
  initial,
}: {
  mode: ViewMode;
  onView: (mode: ViewMode) => void;
  cubeRef: MutableRefObject<((azimuth: number, elevation: number) => void) | null>;
  initial: { azimuth: number; elevation: number };
}) {
  const faces = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const turn = (azimuth: number, elevation: number) => {
      faceTransforms(azimuth, elevation).forEach((transform, i) => {
        const face = faces.current[i];
        if (face) face.style.transform = transform;
      });
    };
    turn(initial.azimuth, initial.elevation);
    cubeRef.current = turn;
    return () => {
      cubeRef.current = null;
    };
  }, [cubeRef, initial.azimuth, initial.elevation]);

  return (
    <div className="view-cube-box" data-testid="view-cube" data-hud>
      <div className="view-cube" role="group" aria-label="Views">
        <div className="view-cube-body">
          {FACES.map(({ id, label }, i) => (
            <button
              key={id}
              ref={(el) => {
                faces.current[i] = el;
              }}
              type="button"
              className="view-cube-face"
              data-testid={`view-${id}`}
              data-hand-press
              aria-pressed={mode === id}
              aria-label={`${label} view`}
              title={`${label} view`}
              onClick={() => onView(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="constraint-chip view-cube-perspective"
        data-testid="view-perspective"
        data-hand-press
        aria-pressed={mode === "perspective"}
        onClick={() => onView("perspective")}
      >
        Perspective
      </button>
    </div>
  );
}
