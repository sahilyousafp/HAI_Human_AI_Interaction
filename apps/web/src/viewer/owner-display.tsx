import { TAG_OWNER } from "@hai/protocol";
import { Edges } from "@react-three/drei";
import { createContext, useContext, useEffect } from "react";
import * as THREE from "three";
import { baseAgent, type ClaimBox } from "../agent/owners.ts";
import { MM } from "./geometry.ts";

/**
 * Who owns what, as the viewer shows it: each element an agent owns is outlined and tinted in that agent's colour, the
 * elements of a claim the user hovers in the panel are lit, and region claims are drawn as translucent boxes. It is
 * drawn under selection, hover and the pending-deletion mark, which keep their own colours.
 */
export interface OwnerDisplay {
  /** Each agent's colour by its lower-case name; an element's or object's `hai.owner` tag is looked up in it. */
  colors: ReadonlyMap<string, string>;
  /** The elements of the claim under the pointer in the panel, and that claim's colour. */
  highlight: ReadonlySet<string>;
  highlightColor: string | null;
  boxes: ClaimBox[];
}

export const NO_OWNERS: OwnerDisplay = {
  colors: new Map(),
  highlight: new Set(),
  highlightColor: null,
  boxes: [],
};

export const OwnerDisplayContext = createContext<OwnerDisplay>(NO_OWNERS);

/** How strongly an owner's colour tints a surface: a hint, so the model still reads as a model. */
export const OWNER_TINT = 0.3;

/** What an element or object should wear for its owner: its colour (null when it has none) and any panel highlight. */
export function useOwnerDisplay(
  id: string,
  tags: Record<string, string> | undefined,
): { owner: string | null; glow: string | null } {
  const display = useContext(OwnerDisplayContext);
  const name = tags?.[TAG_OWNER]?.toLowerCase();
  return {
    // A worker wears its specialist's colour.
    owner: (name ? (display.colors.get(name) ?? display.colors.get(baseAgent(name))) : undefined) ?? null,
    glow: display.highlight.has(id) ? display.highlightColor : null,
  };
}

/** What an element or object is drawn with now, for end-to-end tests (dev builds only fill it). */
export interface Wear {
  color: string;
  /** The edge colour when it differs from the default (an owner's or a highlight), else null. */
  outline: string | null;
  glow: string | null;
}
const worn = new Map<string, Wear>();
export const wornBy = (id: string): Wear | null => worn.get(id) ?? null;

/** Records what an element is drawn with, so a test can ask (dev builds only). */
export function useWear(id: string, color: string, outline: string | null, glow: string | null): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    worn.set(id, { color, outline, glow });
    return () => void worn.delete(id);
  }, [id, color, outline, glow]);
}

/** `base` moved `amount` of the way to `owner`, as a CSS colour. */
export function tint(base: string, owner: string, amount: number): string {
  return `#${new THREE.Color(base).lerp(new THREE.Color(owner), amount).getHexString()}`;
}

/** Region claims, as boxes of light space in the agent's colour. They are never picked. */
export function ClaimBoxes({ boxes }: { boxes: ClaimBox[] }) {
  return (
    <>
      {boxes.map((box) => {
        const size = [0, 1, 2].map((k) => (box.max[k] as number) - (box.min[k] as number));
        const centre = [0, 1, 2].map((k) => ((box.min[k] as number) + (box.max[k] as number)) / 2);
        return (
          <mesh
            key={box.key}
            position={
              [centre[0] as number, centre[1] as number, centre[2] as number].map((v) => v * MM) as [
                number,
                number,
                number,
              ]
            }
            raycast={() => null}
            renderOrder={2}
            data-claim-box={box.key}
          >
            <boxGeometry args={size.map((v) => v * MM) as [number, number, number]} />
            <meshBasicMaterial color={box.color} transparent opacity={0.1} depthWrite={false} />
            <Edges color={box.color} />
          </mesh>
        );
      })}
    </>
  );
}
