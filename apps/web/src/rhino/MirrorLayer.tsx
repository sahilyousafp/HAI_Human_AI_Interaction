import type { RhinoObject } from "@hai/protocol";
import type { MeshPart } from "@hai/scene";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import * as THREE from "three";
import type { ModelAssets } from "../import/model-assets.ts";
import { MM, modelGeometry } from "../viewer/geometry.ts";
import { OWNER_TINT, tint, useOwnerDisplay, useWear } from "../viewer/owner-display.tsx";
import type { RhinoMirror } from "./rhino-mirror.ts";

/** The colours the layer needs from the viewer. */
export interface MirrorColors {
  element: string;
  hover: string;
  selected: string;
}

/** A box for an object too heavy to mirror in full, or one whose mesh could not be had. */
function boxGeometry({ bounds }: RhinoObject): THREE.BufferGeometry {
  const size = [0, 1, 2].map((k) => Math.max(1, (bounds.max[k] as number) - (bounds.min[k] as number)) * MM);
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  geometry.translate(
    ((bounds.min[0] + bounds.max[0]) / 2) * MM,
    ((bounds.min[1] + bounds.max[1]) / 2) * MM,
    ((bounds.min[2] + bounds.max[2]) / 2) * MM,
  );
  return geometry;
}

function MirrorMesh({
  object,
  assets,
  colors,
  hovered,
  selected,
}: {
  object: RhinoObject;
  assets: ModelAssets;
  colors: MirrorColors;
  hovered: boolean;
  selected: boolean;
}) {
  const { asset } = object;
  useEffect(() => {
    if (asset) assets.ensure(asset);
  }, [assets, asset]);
  // Only this object's own asset: a mesh arriving for one object does not redraw the other forty-nine.
  useSyncExternalStore(assets.subscribe, () => (asset ? assets.state(asset) : undefined));
  const parts: MeshPart[] | null = asset ? assets.parts(asset) : null;
  // The mesh is in millimetres (the scene mesh format) and is scaled to the viewer's metres; until it arrives, or if it
  // cannot be had, the object is its bounding box.
  const geometries = useMemo(
    () => (parts && parts.length > 0 ? parts.map((part) => modelGeometry(part)) : [boxGeometry(object)]),
    [parts, object],
  );
  const scale = parts && parts.length > 0 ? MM : 1;
  useEffect(
    () => () => {
      for (const geometry of geometries) geometry.dispose();
    },
    [geometries],
  );
  const { owner, glow } = useOwnerDisplay(object.id, object.tags);
  const base = object.color ?? colors.element;
  // What an agent's picture shows: the owner's tint, without the user's hover and selection.
  const clean = owner ? tint(base, owner, OWNER_TINT) : base;
  let color = base;
  if (owner && !selected && !hovered) color = tint(color, owner, OWNER_TINT);
  if (hovered) color = colors.hover;
  if (selected) color = colors.selected;
  useWear(object.id, color, null, glow);
  return (
    <>
      {geometries.map((geometry, i) => (
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: an object's parts never reorder
          key={i}
          geometry={geometry}
          scale={scale}
          castShadow
          receiveShadow
          userData={{ elementId: object.id, rhino: true, cleanColor: clean }}
        >
          <meshStandardMaterial
            color={color}
            roughness={0.9}
            metalness={0}
            flatShading
            {...(glow ? { emissive: glow, emissiveIntensity: 0.6 } : {})}
          />
        </mesh>
      ))}
    </>
  );
}

/**
 * Rhino's objects, drawn read-only beside the HAI scene. They are not elements of the scene: a pick on one has the
 * object's Rhino id, and the viewer sends it to Rhino to select. After each drawn frame the mirror is told which
 * batches are now on screen, which is how the Rhino to HAI latency is measured.
 */
export function MirrorLayer({
  mirror,
  assets,
  colors,
  hoverId,
}: {
  mirror: RhinoMirror;
  assets: ModelAssets;
  colors: MirrorColors;
  hoverId: string | null;
}) {
  const state = useSyncExternalStore(mirror.subscribe, mirror.getSnapshot);
  const selected = useMemo(() => new Set(state.selection), [state.selection]);
  useFrame(() => {
    // After this frame has been drawn: a batch whose meshes are in is on screen.
    requestAnimationFrame(() =>
      mirror.frameDrawn((asset) => {
        const status = assets.state(asset)?.status;
        return status === "ready" || status === "missing";
      }),
    );
  });
  return (
    <>
      {state.objects.map((object) => (
        <MirrorMesh
          key={object.id}
          object={object}
          assets={assets}
          colors={colors}
          hovered={hoverId === object.id}
          selected={selected.has(object.id)}
        />
      ))}
    </>
  );
}
