import type { HeldTarget, Point3Mm, SceneDocument } from "@hai/protocol";
import { elementBounds } from "@hai/scene";
import { Html, Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { SECTION_PAD_MM } from "../tools/builtin.ts";
import type { ReferenceSnapshot } from "../tools/reference-layer.ts";
import { MM } from "./geometry.ts";

const toMetres = (p: Point3Mm): [number, number, number] => [p[0] * MM, p[1] * MM, p[2] * MM];

/** Measure: the picked points, the line between them and its length in millimetres. */
export function MeasureMarks({ points, color }: { points: Point3Mm[]; color: string }) {
  const [a, b] = points;
  return (
    <group>
      {points.map((p) => (
        <mesh key={p.join(",")} position={toMetres(p)}>
          <sphereGeometry args={[0.18, 16, 12]} />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
      ))}
      {a && b && (
        <>
          <Line points={[toMetres(a), toMetres(b)]} color={color} lineWidth={2.5} depthTest={false} />
          <Html position={toMetres([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])} center>
            <span className="measure-label" data-testid="measure-label">
              {Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))} mm
            </span>
          </Html>
        </>
      )}
    </group>
  );
}

/**
 * A drawing aid's snap: a ring on the snapped point and the aid's name beside it. Drawn as page elements, so it keeps
 * its size at any zoom and is never hidden by the element it snapped to.
 */
export function SnapMarker({ point, label }: { point: Point3Mm; label: string }) {
  return (
    <group position={toMetres(point)}>
      <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <span className="snap-marker">
          <span className="snap-dot" aria-hidden="true" />
          <span className="snap-label" data-testid="snap-label" data-point={point.slice(0, 2).join(",")}>
            {label}
          </span>
        </span>
      </Html>
    </group>
  );
}

/**
 * Section: the cut drawn as a plane you can grab, a faint fill with a dashed outline around the model; stronger
 * when the pointer is over it (with the Section tool, a pinch there grabs it).
 */
export function SectionPlane({
  heightMm,
  bounds,
  color,
  hovered,
}: {
  heightMm: number;
  bounds: { min: Point3Mm; max: Point3Mm };
  color: string;
  hovered: boolean;
}) {
  const pad = SECTION_PAD_MM;
  const z = heightMm;
  const [x0, y0] = [bounds.min[0] - pad, bounds.min[1] - pad];
  const [x1, y1] = [bounds.max[0] + pad, bounds.max[1] + pad];
  const corners: Point3Mm[] = [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
    [x0, y0, z],
  ];
  return (
    <group>
      <mesh position={toMetres([(x0 + x1) / 2, (y0 + y1) / 2, z])} renderOrder={1}>
        <planeGeometry args={[(x1 - x0) * MM, (y1 - y0) * MM]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={hovered ? 0.2 : 0.07}
          depthWrite={false}
          side={THREE.DoubleSide}
          // The plane often lies exactly on a roof (it starts at the top of the model): pull it slightly toward the
          // camera so the two surfaces do not fight over the same depth.
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
      <Line
        points={corners.map(toMetres)}
        color={color}
        lineWidth={hovered ? 2.5 : 1.5}
        dashed={!hovered}
        dashSize={0.6}
        gapSize={0.4}
      />
    </group>
  );
}

/**
 * Hides everything above the section height on the model's elements (meshes and their edges), using three.js
 * local clipping planes. Re-applied when the scene changes, so new elements are cut too.
 */
export function SectionClipping({ heightMm, version }: { heightMm: number | null; version: unknown }) {
  const { gl, scene, invalidate } = useThree();
  const planes = useMemo(
    // Half a millimetre above the cut, so a floor or roof lying exactly at the section height is kept whole instead
    // of being clipped pixel by pixel on rounding.
    () => (heightMm === null ? [] : [new THREE.Plane(new THREE.Vector3(0, 0, -1), (heightMm + 0.5) * MM)]),
    [heightMm],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` changes when elements are added or rebuilt
  useEffect(() => {
    gl.localClippingEnabled = true;
    scene.traverse((object) => {
      if (typeof object.userData.elementId !== "string") return;
      object.traverse((part) => {
        const material = (part as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const m of Array.isArray(material) ? material : material ? [material] : []) {
          m.clippingPlanes = planes;
        }
      });
    });
    invalidate();
  }, [gl, scene, planes, invalidate, version]);
  return null;
}

/**
 * Point and speak: a numbered marker over each element captured while the user speaks, so they see what "this" and
 * "these" will mean before the request is sent.
 */
export function ReferenceMarkers({ ids, doc }: { ids: string[]; doc: SceneDocument | null }) {
  return (
    <group>
      {ids.map((id, i) => {
        const element = doc?.elements[id];
        if (!element) return null;
        const { min, max } = elementBounds(element, doc?.levels ?? []);
        return (
          <Html key={id} position={toMetres([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, max[2]])} center>
            <span className="reference-marker" data-testid="reference-marker" data-element={id}>
              {i + 1}
            </span>
          </Html>
        );
      })}
    </group>
  );
}

/** The colour of what a hand drew, by hand (the mouse draws in the accent colour). */
export type HandColors = Record<"Left" | "Right" | "mouse", string>;

function SketchMark({
  kind,
  points,
  label,
  color,
  draft,
}: {
  kind: "path" | "outline";
  points: Point3Mm[];
  label: string | null;
  color: string;
  draft?: boolean;
}) {
  const metres = points.map(toMetres);
  const closed = kind === "outline" && metres.length > 2 && !draft;
  const fill = useMemo(() => {
    if (!closed) return null;
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x * MM, y * MM)));
    return new THREE.ShapeGeometry(shape);
  }, [closed, points]);
  useEffect(() => () => fill?.dispose(), [fill]);
  const [first] = points;
  if (metres.length < 2 || !first) return null;
  const z = (points.reduce((sum, p) => sum + p[2], 0) / points.length) * MM;
  return (
    <group>
      {fill && (
        <mesh geometry={fill} position={[0, 0, z + 0.01]}>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.12}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      <Line
        points={closed ? [...metres, metres[0] as [number, number, number]] : metres}
        color={color}
        lineWidth={2.5}
        dashed
        dashSize={0.5}
        gapSize={0.3}
        depthTest={false}
      />
      {label && (
        <Html position={toMetres(first)} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <span
            className="sketch-label"
            data-testid="sketch-label"
            data-kind={kind}
            style={{ borderColor: color, color }}
          >
            {label}
          </span>
        </Html>
      )}
    </group>
  );
}

/**
 * What the user pointed out for the agent: sketches as dashed lines (outlines lightly filled) in the colour of the hand
 * that drew them, labelled S1, S2 and so on, the sketch being drawn, and the lettered markers. None of it is the
 * model, and agents' own pictures leave it out.
 */
export function ReferenceMarks({
  references,
  colors,
}: {
  references: ReferenceSnapshot;
  colors: HandColors;
}) {
  const { sketches, draft, markers } = references;
  // Markers are often there from the start (kept with the project). drei's Html moves its element to the canvas's event
  // layer once that connects, unmounting its React root mid-render, which can leave a label empty and stall the frame
  // loop; so nothing is drawn until the events are connected and the view has drawn its first frame.
  const connected = useThree((state) => state.events.connected);
  const [drawn, setDrawn] = useState(false);
  useFrame(() => {
    if (!drawn) setDrawn(true);
  });
  if (!connected || !drawn) return null;
  return (
    <group>
      {sketches.map((s) => (
        <SketchMark
          key={s.label}
          kind={s.kind}
          points={s.points}
          label={s.label}
          color={colors[s.hand ?? "mouse"]}
        />
      ))}
      {draft && (
        <SketchMark
          kind={draft.kind}
          points={draft.points}
          label={null}
          color={colors[draft.hand ?? "mouse"]}
          draft
        />
      )}
      {markers.map((m) => (
        <Html
          key={m.letter}
          position={toMetres(m.point)}
          center
          zIndexRange={[20, 0]}
          style={{ pointerEvents: "none" }}
        >
          <span className="letter-marker" data-testid="letter-marker" data-letter={m.letter}>
            <span className="letter-marker-letter">{m.letter}</span>
          </span>
        </Html>
      ))}
    </group>
  );
}

/**
 * What a held pinch locked ("this"): an element's box outlined in the colour of the hand that holds it, or a point
 * marked with a ring and, when a drawing aid placed it, the aid's name.
 */
export function HeldTargetMark({
  target,
  doc,
  color,
}: {
  target: HeldTarget;
  doc: SceneDocument | null;
  color: string;
}) {
  const element = target.kind === "element" ? doc?.elements[target.id] : undefined;
  const box = useMemo(() => {
    if (!element) return null;
    const { min, max } = elementBounds(element, doc?.levels ?? []);
    const [x0, y0, z0] = toMetres(min);
    const [x1, y1, z1] = toMetres(max);
    const ring = (z: number): Array<[number, number, number]> => [
      [x0, y0, z],
      [x1, y0, z],
      [x1, y1, z],
      [x0, y1, z],
      [x0, y0, z],
    ];
    const posts = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map(
      ([x = 0, y = 0]): Array<[number, number, number]> => [
        [x, y, z0],
        [x, y, z1],
      ],
    );
    return [ring(z0), ring(z1), ...posts];
  }, [element, doc]);
  if (target.kind === "element") {
    if (!box) return null;
    return (
      <group>
        {box.map((points) => (
          <Line
            key={points.flat().join(",")}
            points={points}
            color={color}
            lineWidth={2.5}
            depthTest={false}
          />
        ))}
      </group>
    );
  }
  return (
    <group position={toMetres(target.point)}>
      <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <span className="held-target" data-testid="held-target" style={{ borderColor: color }}>
          {target.aid && <span className="held-target-label">{target.aid}</span>}
        </span>
      </Html>
    </group>
  );
}

/** The points a holding hand rested on while speaking, labelled P1, P2 and so on until the request goes. */
export function HeldPoints({ points }: { points: Point3Mm[] }) {
  return (
    <group>
      {points.map((point, i) => (
        <Html
          key={point.join(",")}
          position={toMetres(point)}
          center
          zIndexRange={[20, 0]}
          style={{ pointerEvents: "none" }}
        >
          <span className="held-point" data-testid="held-point">
            P{i + 1}
          </span>
        </Html>
      ))}
    </group>
  );
}
