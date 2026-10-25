import type { TeamCamera, TeamMemberInfo } from "@hai/protocol";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { USER_ONLY } from "./agent-shot.ts";
import { MM } from "./geometry.ts";
import { cameraPosition } from "./turntable.ts";

/** One agent camera, as the model shows it: where it stands, what it looks at, and whose it is. */
export interface CameraMarker {
  key: string;
  agent: string;
  name: string;
  color: string;
  /** Metres. */
  position: [number, number, number];
  target: [number, number, number];
  /** Metres: the marker's size, growing with the camera's distance so it stays findable. */
  size: number;
}

/** The markers for the agents' cameras, each in its agent's colour (grey when no member has the name). */
export function cameraMarkers(cameras: TeamCamera[], members: TeamMemberInfo[]): CameraMarker[] {
  return cameras.map((c) => {
    const target: [number, number, number] = [c.target[0] * MM, c.target[1] * MM, c.target[2] * MM];
    return {
      key: `${c.agent}/${c.name}`,
      agent: c.agent,
      name: c.name,
      color: members.find((m) => m.name === c.agent)?.color ?? "#8e8e93",
      position: cameraPosition({
        target,
        azimuth: c.azimuth,
        elevation: c.elevation,
        distance: c.distance * MM,
      }),
      target,
      size: Math.min(4, Math.max(0.4, c.distance * MM * 0.03)),
    };
  });
}

const UP = new THREE.Vector3(0, 1, 0);

function Marker({ m }: { m: CameraMarker }) {
  const { quaternion, line, length } = useMemo(() => {
    const from = new THREE.Vector3(...m.position);
    const to = new THREE.Vector3(...m.target);
    return {
      quaternion: new THREE.Quaternion().setFromUnitVectors(UP, from.clone().sub(to).normalize()),
      line: new THREE.BufferGeometry().setFromPoints([from, from.clone().lerp(to, 0.35)]),
      length: from.distanceTo(to),
    };
  }, [m.position, m.target]);
  useEffect(() => () => line.dispose(), [line]);
  return (
    <group data-camera-marker={m.key}>
      <mesh
        position={m.position}
        quaternion={quaternion}
        raycast={() => null}
        renderOrder={3}
        scale={Math.min(m.size, length / 3)}
      >
        {/* The tip at the origin, the opening toward the target (the cone's apex is +Y, so it is flipped). */}
        <coneGeometry args={[0.45, 1, 16, 1, true]} onUpdate={(g) => g.translate(0, -0.5, 0)} />
        <meshBasicMaterial
          color={m.color}
          transparent
          opacity={0.55}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={line} raycast={() => null} renderOrder={3}>
        <lineBasicMaterial color={m.color} transparent opacity={0.7} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

/**
 * A small cone at each camera with its tip at the camera, opening toward what it looks at, and a thin line to that
 * point. The markers are the user's to see: they are never picked, and agents' pictures leave them out.
 */
export function CameraMarkers({ markers }: { markers: CameraMarker[] }) {
  return (
    <group userData={USER_ONLY}>
      {markers.map((m) => (
        <Marker key={m.key} m={m} />
      ))}
    </group>
  );
}
