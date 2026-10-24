import { useEffect, useState } from "react";
import type { ModelAssets } from "../import/model-assets.ts";
import type { RhinoMirror } from "./rhino-mirror.ts";

/**
 * A number that changes when Rhino's objects or their meshes do, at most once per animation frame: an edit of fifty
 * objects brings fifty meshes one after another, and the view needs to hear of them once.
 */
export function useMirrorVersion(mirror: RhinoMirror, assets: ModelAssets): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let frame = 0;
    const bump = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setVersion((v) => v + 1);
      });
    };
    const offMirror = mirror.subscribe(bump);
    const offAssets = assets.subscribe(bump);
    return () => {
      cancelAnimationFrame(frame);
      offMirror();
      offAssets();
    };
  }, [mirror, assets]);
  return version;
}
