import type { Point3Mm } from "@aex/protocol";
import { Html, Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { SECTION_PAD_MM } from "../tools/builtin.ts";
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
