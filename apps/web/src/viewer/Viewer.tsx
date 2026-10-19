import type { Element, GestureEvent, Point2, SceneDocument } from "@aex/protocol";
import { Edges, Grid } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type FormEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { isSoftwareRenderer } from "../gpu.ts";
import type { InputBus } from "../input/input-bus.ts";
import type { SceneClient, SceneState } from "../scene/scene-client.ts";
import { elementGeometry, sceneBounds } from "./geometry.ts";
import type { LatencyTracker } from "./latency.ts";
import { initialInput, movesCamera, navigate } from "./navigation.ts";
import { cameraPosition, frameBox, orbit, pan, type Turntable, zoom } from "./turntable.ts";

const FOV = 45;
/** Camera easing time constant: smooths hand jitter without adding visible lag. */
const EASE_MS = 40;
/** Hands rarely reach the frame edges comfortably, so the pointer amplifies motion around the centre. */
const POINTER_GAIN = 1.3;

declare global {
  interface Window {
    /** Dev builds only: viewer state for end-to-end tests. */
    __AEX_VIEWER__?: {
      camera(): Turntable;
      meshCount(): number;
      pick(x: number, y: number): string | null;
      latencyP90(): number | null;
    };
    /** Dev builds only: inject hand input exactly as the tracker would. */
    __AEX_INPUT__?: {
      gestures(events: GestureEvent[]): void;
      pointer(position: Point2 | null): void;
      engaged(engaged: boolean): void;
    };
  }
}

interface Colors {
  background: string;
  element: string;
  massing: string;
  edge: string;
  selected: string;
  hover: string;
  grid: string;
}

function readColors(): Colors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: v("--viewer-bg"),
    element: v("--model"),
    massing: v("--model-massing"),
    edge: v("--model-edge"),
    selected: v("--accent"),
    hover: v("--model-hover"),
    grid: v("--viewer-grid"),
  };
}

function projectStatusText(scene: SceneState): string {
  if (scene.projectError) return scene.projectError;
  if (scene.savedAt) return `Saved ${new Date(scene.savedAt).toLocaleTimeString()}`;
  if (scene.project) return "All changes saved";
  return "Sample (not saved)";
}

/** Pointer position on the viewer (0..1, y down) from the hand pointer in camera-frame coordinates. */
export function handToViewer([x, y]: Point2): Point2 {
  const map = (v: number) => Math.min(1, Math.max(0, 0.5 + (v - 0.5) * POINTER_GAIN));
  return [map(x), map(y)];
}

function ElementMesh({
  element,
  doc,
  colors,
  selected,
  hovered,
}: {
  element: Element;
  doc: SceneDocument;
  colors: Colors;
  selected: boolean;
  hovered: boolean;
}) {
  const geometry = useMemo(() => elementGeometry(element, doc.levels), [element, doc.levels]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  let color = element.type === "massing" ? colors.massing : colors.element;
  if (hovered) color = colors.hover;
  if (selected) color = colors.selected;
  return (
    <mesh geometry={geometry} castShadow receiveShadow userData={{ elementId: element.id }}>
      <meshStandardMaterial color={color} roughness={0.9} metalness={0} />
      <Edges threshold={20} color={colors.edge} />
    </mesh>
  );
}

/** Drives the camera from the turntable state, eased, and stamps latency after each rendered change. */
function CameraRig({
  nav,
  pendingTs,
  latency,
  pickRef,
}: {
  nav: React.RefObject<Turntable>;
  pendingTs: React.RefObject<number | null>;
  latency: LatencyTracker;
  pickRef: React.RefObject<(x: number, y: number) => string | null>;
}) {
  const { camera, scene, raycaster } = useThree();
  const eased = useRef<Turntable | null>(null);

  useEffect(() => {
    camera.up.set(0, 0, 1);
    scene.onAfterRender = () => {
      const ts = pendingTs.current;
      if (ts === null) return;
      pendingTs.current = null;
      latency.add(performance.timeOrigin + performance.now() - ts);
    };
    pickRef.current = (x, y) => {
      raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)), camera);
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        const id = hit.object.userData.elementId;
        if (typeof id === "string") return id;
      }
      return null;
    };
    return () => {
      scene.onAfterRender = () => {};
    };
  }, [camera, scene, raycaster, pendingTs, latency, pickRef]);

  useFrame((_, delta) => {
    const target = nav.current;
    if (!target) return;
    const k = 1 - Math.exp((-delta * 1000) / EASE_MS);
    const prev = eased.current ?? target;
    let dAz = target.azimuth - prev.azimuth;
    if (dAz > 180) dAz -= 360;
    if (dAz < -180) dAz += 360;
    const next: Turntable = {
      azimuth: prev.azimuth + dAz * k,
      elevation: prev.elevation + (target.elevation - prev.elevation) * k,
      distance: prev.distance + (target.distance - prev.distance) * k,
      target: [
        prev.target[0] + (target.target[0] - prev.target[0]) * k,
        prev.target[1] + (target.target[1] - prev.target[1]) * k,
        prev.target[2] + (target.target[2] - prev.target[2]) * k,
      ],
    };
    eased.current = next;
    camera.position.set(...cameraPosition(next));
    camera.lookAt(...next.target);
  });
  return null;
}

export function Viewer({
  client,
  bus,
  latency,
}: {
  client: SceneClient;
  bus: InputBus;
  /** Gesture-to-render latency, shared with the Detection card. */
  latency: LatencyTracker;
}) {
  const software = useMemo(isSoftwareRenderer, []);
  const scene = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [colors, setColors] = useState<Colors>(readColors);
  const nav = useRef<Turntable>({ target: [20, 15, 3], azimuth: 305, elevation: 32, distance: 70 });
  const navInput = useRef(initialInput());
  const pendingTs = useRef<number | null>(null);
  const pickRef = useRef<(x: number, y: number) => string | null>(() => null);
  const framed = useRef(false);
  const navigating = useRef(false);
  const [pointer, setPointer] = useState<Point2 | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [p90, setP90] = useState<number | null>(null);
  const [projectPath, setProjectPath] = useState("");
  const [openingProject, setOpeningProject] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // Follow theme changes.
  useEffect(() => {
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const refresh = () => setColors(readColors());
    scheme.addEventListener("change", refresh);
    return () => scheme.removeEventListener("change", refresh);
  }, []);

  // Frame the model the first time a scene arrives.
  useEffect(() => {
    if (!scene.doc || framed.current) return;
    const geometries = Object.values(scene.doc.elements).map((e) =>
      elementGeometry(e, scene.doc?.levels ?? []),
    );
    const { min, max } = sceneBounds(geometries);
    for (const g of geometries) g.dispose();
    nav.current = frameBox(min, max);
    framed.current = true;
  }, [scene.doc]);

  // Hand input: gestures move the camera locally (never through the bridge); taps select.
  useEffect(() => {
    const offGestures = bus.onGestures((events) => {
      for (const event of events) {
        nav.current = navigate(nav.current, navInput.current, event);
        if (movesCamera(event)) pendingTs.current = Math.max(pendingTs.current ?? 0, event.ts);
        if (event.type === "pinch.drag.start" || event.type === "twohand.start") navigating.current = true;
        if (event.type === "pinch.drag.end" || event.type === "twohand.end" || event.type === "disengaged") {
          navigating.current = false;
        }
        if (event.type === "pinch.tap") {
          const [x, y] = handToViewer(event.position);
          const id = pickRef.current(x, y);
          client.select(id ? [id] : []);
        }
      }
    });
    const offPointer = bus.onPointer((sample) => {
      if (!sample.position || !bus.engaged || navigating.current) {
        setPointer(null);
        setHoverId(null);
        return;
      }
      const at = handToViewer(sample.position);
      setPointer(at);
      setHoverId(pickRef.current(at[0], at[1]));
    });
    const offEngaged = bus.onEngaged((engaged) => {
      if (!engaged) {
        setPointer(null);
        setHoverId(null);
      }
    });
    return () => {
      offGestures();
      offPointer();
      offEngaged();
    };
  }, [bus, client]);

  // Mouse: left drag orbits (a click selects), right or middle drag pans, wheel zooms.
  useEffect(() => {
    const el = wrapper.current?.querySelector("canvas");
    if (!el) return;
    let drag: { x: number; y: number; button: number; moved: boolean } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.button === 0) nav.current = orbit(nav.current, -dx * 0.3, dy * 0.25);
      else nav.current = pan(nav.current, dx / el.clientHeight, -dy / el.clientHeight, FOV);
    };
    const up = (e: PointerEvent) => {
      if (drag && !drag.moved && drag.button === 0) {
        const rect = el.getBoundingClientRect();
        const id = pickRef.current(
          (e.clientX - rect.left) / rect.width,
          (e.clientY - rect.top) / rect.height,
        );
        client.select(id ? [id] : []);
      }
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      nav.current = zoom(nav.current, Math.exp(e.deltaY * 0.001));
    };
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", menu);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", menu);
    };
  }, [client]);

  // Keyboard: Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo (not while typing).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).closest("input, textarea")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        client.undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        client.redo();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [client]);

  // Latency readout refreshes twice a second.
  useEffect(() => {
    const id = setInterval(() => setP90(latency.p90()), 500);
    return () => clearInterval(id);
  }, [latency]);

  // Dev hooks for end-to-end tests.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__AEX_VIEWER__ = {
      camera: () => nav.current,
      meshCount: () => Object.keys(client.getSnapshot().doc?.elements ?? {}).length,
      pick: (x, y) => pickRef.current(x, y),
      latencyP90: () => latency.p90(),
    };
    window.__AEX_INPUT__ = {
      gestures: (events) => bus.emitGestures(events),
      pointer: (position) => bus.emitPointer({ position, ts: performance.timeOrigin + performance.now() }),
      engaged: (engaged) => bus.setEngaged(engaged),
    };
  }, [bus, client, latency]);

  const selection = new Set(scene.selection);
  const selected = scene.doc && scene.selection[0] ? scene.doc.elements[scene.selection[0]] : undefined;
  const openProject = (e: FormEvent) => {
    e.preventDefault();
    if (projectPath.trim()) client.openProject(projectPath.trim());
    setOpeningProject(false);
  };

  return (
    <section className="viewer" ref={wrapper} aria-label="3D model" data-testid="viewer">
      <Canvas
        shadows={!software}
        camera={{ fov: FOV, near: 0.1, far: 5000, position: [60, -40, 40] }}
        gl={{ antialias: !software, preserveDrawingBuffer: true }}
        dpr={software ? 1 : [1, 2]}
        data-renderer={software ? "software" : "gpu"}
      >
        <color attach="background" args={[colors.background]} />
        <hemisphereLight args={["#ffffff", "#b9b4a8", 1.1]} />
        <directionalLight
          position={[-40, -60, 90]}
          intensity={1.6}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-60}
          shadow-camera-right={60}
          shadow-camera-top={60}
          shadow-camera-bottom={-60}
        />
        <Grid
          rotation={[Math.PI / 2, 0, 0]}
          position={[0, 0, -0.31]}
          cellSize={1}
          sectionSize={10}
          cellColor={colors.grid}
          sectionColor={colors.grid}
          fadeDistance={300}
          infiniteGrid
        />
        {scene.doc &&
          Object.values(scene.doc.elements).map((element) => (
            <ElementMesh
              key={element.id}
              element={element}
              doc={scene.doc as SceneDocument}
              colors={colors}
              selected={selection.has(element.id)}
              hovered={hoverId === element.id}
            />
          ))}
        <CameraRig nav={nav} pendingTs={pendingTs} latency={latency} pickRef={pickRef} />
      </Canvas>

      {pointer && (
        <div
          className="hand-pointer"
          data-testid="hand-pointer"
          style={{ left: `${pointer[0] * 100}%`, top: `${pointer[1] * 100}%` }}
          aria-hidden="true"
        />
      )}

      <div className="viewer-toolbar">
        <div className="project" data-testid="project-status">
          <strong>{scene.project?.name ?? scene.doc?.name ?? "Loading"}</strong>
          <span className="muted">{projectStatusText(scene)}</span>
        </div>
        <div className="toolbar-buttons">
          <button
            type="button"
            className="secondary"
            onClick={() => client.undo()}
            disabled={!scene.canUndo}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => client.redo()}
            disabled={!scene.canRedo}
            title="Redo (Ctrl+Shift+Z)"
          >
            Redo
          </button>
          <button type="button" className="secondary" onClick={() => setOpeningProject((v) => !v)}>
            Open project
          </button>
        </div>
        {openingProject && (
          <form className="open-project" onSubmit={openProject}>
            <input
              type="text"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="D:\Projects\My building"
              aria-label="Project folder path"
            />
            <button type="submit" className="primary">
              Open
            </button>
          </form>
        )}
      </div>

      <div className="viewer-status">
        <span data-testid="selection-status">
          {selected ? `${selected.name} (${selected.type})` : "Nothing selected"}
        </span>
        <span data-testid="hud-latency">
          {p90 === null ? "Gesture to render: -" : `Gesture to render p90: ${Math.round(p90)} ms`}
        </span>
      </div>
    </section>
  );
}
