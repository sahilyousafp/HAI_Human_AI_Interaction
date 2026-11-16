import type { HostObject } from "@hai/protocol";
import type { MeshPart } from "@hai/scene";
import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";
import type { ModelAssets } from "../import/model-assets.ts";
import { MM, modelGeometry } from "../viewer/geometry.ts";
import { OWNER_TINT, tint, useOwnerDisplay, useWear } from "../viewer/owner-display.tsx";
import { type HostMirror, isRepeatedPlacement, placementsByAsset } from "./host-mirror.ts";

/** The colours the layer needs from the viewer. */
export interface MirrorColors {
  element: string;
  hover: string;
  selected: string;
}

/** A box for an object too heavy to mirror in full, or one whose mesh could not be had, in millimetres as a mesh is. */
function boxGeometry({ bounds }: HostObject): THREE.BufferGeometry {
  const size = [0, 1, 2].map((k) => Math.max(1, (bounds.max[k] as number) - (bounds.min[k] as number)));
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  geometry.translate(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  );
  return geometry;
}

/** The placements of a block share one mesh: on the graphics card it is held once, however many there are. */
const sharedGeometries = new WeakMap<MeshPart, { geometry: THREE.BufferGeometry; users: number }>();

function sharedGeometry(part: MeshPart): { geometry: THREE.BufferGeometry; users: number } {
  let shared = sharedGeometries.get(part);
  if (!shared) {
    shared = { geometry: modelGeometry(part), users: 0 };
    sharedGeometries.set(part, shared);
  }
  return shared;
}

/**
 * Counts one more use of a part's shared mesh and returns how to end it. The graphics card's copy goes with the last
 * use; drawn again, it is simply sent again.
 */
function holdGeometry(part: MeshPart): () => void {
  const shared = sharedGeometry(part);
  shared.users++;
  return () => {
    shared.users--;
    if (shared.users === 0) shared.geometry.dispose();
  };
}

/** A 4 x 4 matrix sent row by row (a placement, an edit), as three.js holds it. `fromArray` reads column by column. */
const rowMajor = (m: number[]) => new THREE.Matrix4().fromArray(m).transpose();

/**
 * From a mesh's millimetres to the viewer's metres, by way of where a block's placement puts it and, while the user
 * moves or turns the object, where the edit takes it.
 */
function placementMatrix(transform: number[] | undefined, edit: number[] | null = null): THREE.Matrix4 {
  const toMetres = new THREE.Matrix4().makeScale(MM, MM, MM);
  if (edit) toMetres.multiply(rowMajor(edit));
  return transform ? toMetres.multiply(rowMajor(transform)) : toMetres;
}

const MirrorMesh = memo(function MirrorMesh({
  object,
  assets,
  colors,
  hovered,
  selected,
  edit,
  changed,
}: {
  object: HostObject;
  assets: ModelAssets;
  colors: MirrorColors;
  hovered: boolean;
  selected: boolean;
  /** The user's move or turn, drawn before the host has made it. */
  edit: number[] | null;
  /** The agent changed it for the user's last request about a selection: it glows until the next selection. */
  changed: boolean;
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
  const meshed = parts !== null && parts.length > 0;
  const box = useMemo(() => (meshed ? null : boxGeometry(object)), [meshed, object]);
  useEffect(() => (box ? () => box.dispose() : undefined), [box]);
  const geometries = useMemo(
    () => (meshed ? parts.map((part) => sharedGeometry(part).geometry) : [box as THREE.BufferGeometry]),
    [meshed, parts, box],
  );
  useEffect(() => {
    if (!meshed) return;
    const releases = parts.map(holdGeometry);
    return () => {
      for (const release of releases) release();
    };
  }, [meshed, parts]);
  // A box is drawn where the object's bounds are, so a block's placement is already in it.
  const matrix = useMemo(
    () => placementMatrix(meshed ? object.transform : undefined, edit),
    [meshed, object.transform, edit],
  );
  const { owner, glow: ownerGlow } = useOwnerDisplay(object.id, object.tags);
  const glow = ownerGlow ?? (changed ? colors.selected : null);
  const base = object.color ?? colors.element;
  // What an agent's picture shows: the owner's tint, without the user's hover and selection.
  const clean = owner ? tint(base, owner, OWNER_TINT) : base;
  let color = base;
  if (owner && !selected && !hovered) color = tint(color, owner, OWNER_TINT);
  if (hovered) color = colors.hover;
  if (selected) color = colors.selected;
  useWear(object.id, color, null, glow);
  // A block's parts each have their own colour. Hover and selection cover them all, and the owner's tint goes over each.
  const partColor = (i: number): { shown: string; clean: string } => {
    const own = object.partColors?.[i];
    if (!own) return { shown: color, clean };
    const tinted = owner ? tint(own, owner, OWNER_TINT) : own;
    return { shown: hovered || selected ? color : tinted, clean: tinted };
  };
  return (
    <>
      {geometries.map((geometry, i) => {
        const part = partColor(i);
        return (
          <mesh
            // biome-ignore lint/suspicious/noArrayIndexKey: an object's parts never reorder
            key={i}
            geometry={geometry}
            matrix={matrix}
            matrixAutoUpdate={false}
            castShadow
            receiveShadow
            userData={{ elementId: object.id, mirrored: true, cleanColor: part.clean }}
          >
            <meshStandardMaterial
              color={part.shown}
              roughness={0.9}
              metalness={0}
              flatShading
              side={THREE.DoubleSide}
              shadowSide={THREE.BackSide}
              {...(glow ? { emissive: glow, emissiveIntensity: 0.6 } : {})}
            />
          </mesh>
        );
      })}
    </>
  );
});

/** One part of a repeated block, drawn for all of its quiet placements in one call to the graphics card. */
function BatchedPart({
  part,
  index,
  placements,
  capacity,
  fallbackColor,
}: {
  part: MeshPart;
  index: number;
  placements: HostObject[];
  capacity: number;
  fallbackColor: string;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = sharedGeometry(part).geometry;
  useEffect(() => holdGeometry(part), [part]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const color = new THREE.Color();
    placements.forEach((placement, i) => {
      mesh.setMatrixAt(i, placementMatrix(placement.transform));
      mesh.setColorAt(i, color.set(placement.partColors?.[index] ?? placement.color ?? fallbackColor));
    });
    mesh.count = placements.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placements, index, fallbackColor]);
  const elementIds = useMemo(() => placements.map((p) => p.id), [placements]);
  return (
    <instancedMesh
      // The number of slots is fixed when it is made: a block placed more times gets a new one.
      key={capacity}
      ref={ref}
      args={[geometry, undefined, capacity]}
      castShadow
      receiveShadow
      // A string `elementId` is how the section tool finds what to cut; a pick goes by `elementIds` and the instance hit.
      userData={{ elementId: "mirror-batch", elementIds, mirrored: true }}
    >
      <meshStandardMaterial
        roughness={0.9}
        metalness={0}
        flatShading
        side={THREE.DoubleSide}
        shadowSide={THREE.BackSide}
      />
    </instancedMesh>
  );
}

/** The quiet placements of a block used many times. Its colours are its own; a hovered or selected one is drawn alone. */
const BlockBatch = memo(function BlockBatch({
  asset,
  placements,
  capacity,
  assets,
  fallbackColor,
}: {
  asset: string;
  placements: HostObject[];
  capacity: number;
  assets: ModelAssets;
  fallbackColor: string;
}) {
  useEffect(() => assets.ensure(asset), [assets, asset]);
  useSyncExternalStore(assets.subscribe, () => assets.state(asset));
  const parts = assets.parts(asset);
  if (!parts) return null;
  return (
    <>
      {parts.map((part, i) => (
        <BatchedPart
          // biome-ignore lint/suspicious/noArrayIndexKey: a mesh's parts never reorder
          key={i}
          part={part}
          index={i}
          placements={placements}
          capacity={capacity}
          fallbackColor={fallbackColor}
        />
      ))}
    </>
  );
});

/**
 * One host's objects, drawn beside the HAI scene. They are not elements of the scene: a pick on one has the object's id
 * in its host, and the viewer sends it to that host to select; the user's move, turn or delete is drawn here first,
 * until the host's result arrives. After each drawn frame the mirror is told
 * which batches are now on screen, which is how the host to HAI latency is measured.
 */
export function MirrorLayer({
  mirror,
  assets,
  colors,
  hoverId,
}: {
  mirror: HostMirror;
  assets: ModelAssets;
  colors: MirrorColors;
  hoverId: string | null;
}) {
  const state = useSyncExternalStore(mirror.subscribe, mirror.getSnapshot);
  const selected = useMemo(() => new Set(state.selection), [state.selection]);
  // The user's edit before the host has made it: moved objects drawn where it takes them, deleted ones not drawn.
  const { preview } = state;
  const edited = useMemo(() => new Set(preview?.ids ?? []), [preview]);
  const editMatrix = preview && "matrix" in preview ? preview.matrix : null;
  const deleted = preview !== null && "deleted" in preview;
  const changed = useMemo(() => new Set(state.changed), [state.changed]);
  // A block placed many times is drawn in one call rather than thousands. A placement that has to look different, for
  // being pointed at, selected or owned by an agent, is drawn on its own.
  const { singles, batches } = useMemo(() => {
    const counts = placementsByAsset(state.objects);
    const single: HostObject[] = [];
    const batched = new Map<string, HostObject[]>();
    for (const object of state.objects) {
      if (deleted && edited.has(object.id)) continue;
      const quiet =
        hoverId !== object.id &&
        !selected.has(object.id) &&
        !edited.has(object.id) &&
        !changed.has(object.id) &&
        Object.keys(object.tags).length === 0;
      if (!isRepeatedPlacement(object, counts) || !quiet) {
        single.push(object);
        continue;
      }
      const list = batched.get(object.asset as string);
      if (list) list.push(object);
      else batched.set(object.asset as string, [object]);
    }
    return {
      singles: single,
      batches: [...batched].map(([asset, placements]) => ({
        asset,
        placements,
        capacity: counts.get(asset) ?? 0,
      })),
    };
  }, [state.objects, hoverId, selected, edited, deleted, changed]);
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
      {batches.map(({ asset, placements, capacity }) => (
        <BlockBatch
          key={asset}
          asset={asset}
          placements={placements}
          capacity={capacity}
          assets={assets}
          fallbackColor={colors.element}
        />
      ))}
      {singles.map((object) => (
        <MirrorMesh
          key={object.id}
          object={object}
          assets={assets}
          colors={colors}
          hovered={hoverId === object.id}
          selected={selected.has(object.id)}
          edit={edited.has(object.id) ? editMatrix : null}
          changed={changed.has(object.id)}
        />
      ))}
    </>
  );
}
