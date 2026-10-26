import type { ContextBuilding, ContextRaster } from "@hai/protocol";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ContextState } from "./context-client.ts";
import { buildingMesh, treePlacements } from "./context-geometry.ts";

const MM = 0.001;

/** The colours the layer takes from the viewer's theme: quieter than the model's own elements. */
export interface ContextColors {
  element: string;
  background: string;
}

/**
 * The tint of the neighbours: a quiet, cool grey, lighter or darker with the theme, so they read as surroundings and
 * never as elements of the model (which are warm greys).
 */
export function contextColor(background: string): string {
  return new THREE.Color(background).getHSL({ h: 0, s: 0, l: 0 }).l > 0.5 ? "#aeb8c4" : "#5f6a77";
}

/** Marks everything of the layer, so a picture an agent takes can show it while the user's view hides it. */
export const CONTEXT_LAYER = { contextLayer: true } as const;

/** A raycast that hits nothing: the layer is never picked, and a ray passes through it to the model behind. */
const noRaycast = () => {};

function Buildings({ buildings, color }: { buildings: ContextBuilding[]; color: string }) {
  const geometry = useMemo(() => {
    const mesh = buildingMesh(buildings);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeBoundingSphere();
    return g;
  }, [buildings]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (buildings.length === 0 || geometry.index?.count === 0) return null;
  return (
    <mesh geometry={geometry} castShadow receiveShadow raycast={noRaycast} frustumCulled={false}>
      <meshStandardMaterial color={color} roughness={0.95} metalness={0} flatShading />
    </mesh>
  );
}

function Trees({ placements }: { placements: Array<{ x: number; y: number; height: number }> }) {
  const geometry = useMemo(() => {
    // A cone for the crown on a short trunk, one unit tall; each tree scales it to its height.
    const crown = new THREE.ConeGeometry(0.22, 0.75, 7);
    crown.rotateX(Math.PI / 2);
    crown.translate(0, 0, 0.625);
    return crown;
  }, []);
  const mesh = useMemo(() => {
    const instanced = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: "#7fa07a", roughness: 0.95, flatShading: true }),
      Math.max(1, placements.length),
    );
    const matrix = new THREE.Matrix4();
    placements.forEach((p, i) => {
      matrix.compose(
        new THREE.Vector3(p.x, p.y, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(p.height, p.height, p.height),
      );
      instanced.setMatrixAt(i, matrix);
    });
    instanced.count = placements.length;
    instanced.instanceMatrix.needsUpdate = true;
    instanced.castShadow = true;
    instanced.frustumCulled = false;
    instanced.raycast = noRaycast;
    return instanced;
  }, [geometry, placements]);
  useEffect(
    () => () => {
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    },
    [mesh],
  );
  if (placements.length === 0) return null;
  return <primitive object={mesh} />;
}

function Raster({ raster, index }: { raster: ContextRaster; index: number }) {
  // The canvas draws on demand: when the picture has loaded, ask for a frame.
  const { invalidate } = useThree();
  const texture = useMemo(
    () => new THREE.TextureLoader().load(raster.image, () => invalidate()),
    [raster.image, invalidate],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  const width = (raster.maxMm[0] - raster.minMm[0]) * MM;
  const depth = (raster.maxMm[1] - raster.minMm[1]) * MM;
  return (
    <mesh
      position={[
        ((raster.minMm[0] + raster.maxMm[0]) / 2) * MM,
        ((raster.minMm[1] + raster.maxMm[1]) / 2) * MM,
        -0.29 + index * 0.002,
      ]}
      raycast={noRaycast}
      renderOrder={-1}
      receiveShadow
    >
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial map={texture} transparent opacity={0.85} depthWrite={false} />
    </mesh>
  );
}

/**
 * The city context agents fetched (buildings, trees, ground data), drawn read-only beside the model. It is not part of
 * the scene: nothing in it is picked or snapped to, it is drawn in a quiet tint that cannot be taken for a model
 * element, and it casts shadows on the model. With `visible` off (Settings > Open data > Show context) the user's view
 * hides it, and an agent's own picture still shows it.
 */
export function ContextLayer({
  state,
  colors,
  visible,
}: {
  state: ContextState;
  colors: ContextColors;
  visible: boolean;
}) {
  const buildings = useMemo(
    () => state.items.filter((i): i is ContextBuilding => i.kind === "building"),
    [state.items],
  );
  const rasters = useMemo(
    () => state.items.filter((i): i is ContextRaster => i.kind === "raster"),
    [state.items],
  );
  const placements = useMemo(() => treePlacements(state.items), [state.items]);
  const color = contextColor(colors.background);
  return (
    <group visible={visible} userData={CONTEXT_LAYER}>
      <Buildings buildings={buildings} color={color} />
      <Trees placements={placements} />
      {rasters.map((raster, i) => (
        <Raster key={raster.id} raster={raster} index={i} />
      ))}
    </group>
  );
}
