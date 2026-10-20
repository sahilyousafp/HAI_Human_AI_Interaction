import type { Element, GestureEvent, Point2, Point3Mm, SceneDocument, SunSetting } from "@aex/protocol";
import { sunLightDirection } from "@aex/scene";
import { Edges, Grid } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import * as THREE from "three";
import { canvasToPng, type ViewLink } from "../agent/view-link.ts";
import { isSoftwareRenderer } from "../gpu.ts";
import type { InputBus } from "../input/input-bus.ts";
import type { SceneClient, SceneState } from "../scene/scene-client.ts";
import { overSectionPlane, SECTION_PAD_MM } from "../tools/builtin.ts";
import type { ToolController } from "../tools/controller.ts";
import { InputRouter, type RouterOptions } from "../tools/input-router.ts";
import { ActiveTool, ToolIcon, ToolOverlays, UndoStrip } from "../tools/ToolOverlays.tsx";
import type { Hit } from "../tools/types.ts";
import { elementGeometry, MM, sceneBounds } from "./geometry.ts";
import type { LatencyTracker } from "./latency.ts";
import { coast, initialInput, movesCamera, type NavigationInput, navigate } from "./navigation.ts";
import { MeasureMarks, ReferenceMarkers, SectionClipping, SectionPlane } from "./ToolScene.tsx";
import { cameraPosition, frameBox, orbit, pan, type Turntable, zoom } from "./turntable.ts";

const FOV = 45;
/** Camera easing time constant: smooths hand jitter without adding visible lag. */
/**
 * The camera eases toward where gestures put it. Hand input arrives about every 40 ms (one tracking frame); easing
 * over a little more than two of those makes it glide between samples instead of stepping, at the cost of a few
 * tens of milliseconds of lag on large moves (the first rendered change still follows the gesture at once).
 */
const EASE_MS = 100;
/** The eased camera counts as arrived (and rendering stops) within this of its target. */
const SETTLED = { degrees: 0.01, distance: 0.001 };
/** Hands rarely reach the frame edges comfortably, so the pointer amplifies motion around the centre. */
const POINTER_GAIN = 1.3;
/** Holding the right mouse button this long without moving opens the tool palette; moving sooner pans. */
const RIGHT_HOLD_MS = 400;
/** The hand pointer stays put this long when tracking drops the hand for a few frames, instead of blinking out. */
const POINTER_HOLD_MS = 250;

/** How close to the section outline (screen pixels) still counts as on it: about a fingertip's reach. */
const SECTION_LINE_PX = 14;

function distanceToSegment([px, py]: Point2, [ax, ay]: Point2, [bx, by]: Point2): number {
  const [dx, dy] = [bx - ax, by - ay];
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The on-screen button (marked `data-hand-press`) at a viewer position, if any: hands can press HUD buttons. */
function handButtonAt(wrapper: HTMLElement | null, [x, y]: Point2): HTMLButtonElement | null {
  if (!wrapper) return null;
  const rect = wrapper.getBoundingClientRect();
  const el = document.elementFromPoint(rect.left + x * rect.width, rect.top + y * rect.height);
  const button = el?.closest<HTMLButtonElement>("[data-hand-press]");
  return button && wrapper.contains(button) && !button.disabled ? button : null;
}

/** Whether a viewer position is over a HUD panel (marked `data-hud`), where the hand must not reach the model. */
function overHud(wrapper: HTMLElement | null, [x, y]: Point2): boolean {
  if (!wrapper) return false;
  const rect = wrapper.getBoundingClientRect();
  const el = document.elementFromPoint(rect.left + x * rect.width, rect.top + y * rect.height);
  return Boolean(el?.closest("[data-hud]") && wrapper.contains(el));
}

declare global {
  interface Window {
    /** Dev builds only: viewer state for end-to-end tests. */
    __AEX_VIEWER__?: {
      camera(): Turntable;
      meshCount(): number;
      /** The element a click or tap at this viewer position would hit (null under a HUD panel). */
      pick(x: number, y: number): string | null;
      latencyP90(): number | null;
      /** Frames rendered so far (the canvas renders on demand, so an idle view adds none). */
      renders(): number;
      /** Viewer position (0..1) of a scene point in millimetres. */
      project(point: Point3Mm): Point2;
      /** Whether a viewer position is on the section plane. */
      overSection(x: number, y: number): boolean;
      /** The section outline's corners in viewer positions (empty without a section). */
      sectionOutline(): Point2[];
      /** The sun a study set, or null for the viewer's own light. */
      sun(): SunSetting | null;
    };
    /** Dev builds only: the tool controller, for end-to-end tests. */
    __AEX_TOOLS__?: ToolController;
    /** Dev builds only: inject hand input exactly as the tracker would. */
    __AEX_INPUT__?: {
      gestures(events: GestureEvent[]): void;
      pointer(position: Point2 | null, secondary?: Point2 | null): void;
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
  risk: string;
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
    risk: v("--risk"),
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
  marked,
  offsetMm,
  sectionMm,
}: {
  element: Element;
  doc: SceneDocument;
  colors: Colors;
  selected: boolean;
  hovered: boolean;
  /** Waiting for confirmation of its deletion. */
  marked: boolean;
  /** Being moved: drawn this far from where it is, until the move arrives from the bridge. */
  offsetMm: [number, number] | null;
  /** Section height, mm, or null. */
  sectionMm: number | null;
}) {
  const geometry = useMemo(() => elementGeometry(element, doc.levels), [element, doc.levels]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const topMm = useMemo(() => {
    geometry.computeBoundingBox();
    return (geometry.boundingBox?.max.z ?? 0) / MM;
  }, [geometry]);
  // Edge lines clip per segment by its first point, so a cut element's vertical edges would stick up through the
  // section; cut elements are drawn without edges instead.
  const showEdges = sectionMm === null || topMm <= sectionMm;
  let color = element.type === "massing" ? colors.massing : colors.element;
  if (hovered) color = colors.hover;
  if (selected) color = colors.selected;
  if (marked) color = colors.risk;
  const offset: [number, number, number] = offsetMm ? [offsetMm[0] * MM, offsetMm[1] * MM, 0] : [0, 0, 0];
  return (
    <mesh geometry={geometry} position={offset} castShadow receiveShadow userData={{ elementId: element.id }}>
      <meshStandardMaterial color={color} roughness={0.9} metalness={0} />
      {showEdges && <Edges threshold={20} color={colors.edge} />}
    </mesh>
  );
}

/** Scene-space picking helpers the camera rig fills in (they need the live camera). */
interface Picking {
  id(x: number, y: number): string | null;
  hit(x: number, y: number): Hit | null;
  ground(x: number, y: number, heightMm: number): Point3Mm | null;
  project(point: Point3Mm): Point2;
}

const noPicking: Picking = { id: () => null, hit: () => null, ground: () => null, project: () => [0, 0] };

/** An angle difference brought into -180..180 degrees, the short way round. */
function wrap180(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/**
 * Drives the camera from the turntable state, eased, and stamps latency after each rendered change.
 * The canvas renders on demand: code that moves `nav` calls `invalidateRef`, and the rig keeps requesting frames
 * only until the eased camera reaches its target, so an idle view costs nothing (with software WebGL, a constant
 * 60 fps redraw used to take the CPU that hand tracking needs).
 */
function CameraRig({
  nav,
  navInput,
  pendingTs,
  latency,
  pickRef,
  sectionRef,
  invalidateRef,
  rendersRef,
  view,
}: {
  nav: React.RefObject<Turntable>;
  /** Hand navigation state; after a flick it holds the momentum the view coasts with. */
  navInput: React.RefObject<NavigationInput>;
  pendingTs: React.RefObject<number | null>;
  latency: LatencyTracker;
  pickRef: React.RefObject<Picking>;
  /** Section height, mm: surfaces above it are hidden, so they cannot be picked either. */
  sectionRef: React.RefObject<number | null>;
  invalidateRef: React.RefObject<() => void>;
  rendersRef: React.RefObject<() => number>;
  /** Reports the camera to the agent and captures the view for it. */
  view: ViewLink;
}) {
  const { camera, scene, raycaster, invalidate, gl } = useThree();
  invalidateRef.current = invalidate;
  rendersRef.current = () => gl.info.render.frame;
  const eased = useRef<Turntable | null>(null);

  useEffect(() => {
    camera.up.set(0, 0, 1);
    scene.onAfterRender = () => {
      const ts = pendingTs.current;
      if (ts === null) return;
      pendingTs.current = null;
      latency.add(performance.timeOrigin + performance.now() - ts);
    };
    const cast = (x: number, y: number) =>
      raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)), camera);
    const hit = (x: number, y: number): Hit | null => {
      cast(x, y);
      const cut = sectionRef.current;
      for (const h of raycaster.intersectObjects(scene.children, true)) {
        const id = h.object.userData.elementId;
        if (typeof id !== "string") continue;
        if (cut !== null && h.point.z / MM > cut + 1) continue; // hidden above the section
        return { elementId: id, point: [h.point.x / MM, h.point.y / MM, h.point.z / MM] };
      }
      return null;
    };
    pickRef.current = {
      hit,
      id: (x, y) => hit(x, y)?.elementId ?? null,
      ground: (x, y, heightMm) => {
        cast(x, y);
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -heightMm * MM);
        const at = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        return at ? [at.x / MM, at.y / MM, heightMm] : null;
      },
      project: (point) => {
        const v = new THREE.Vector3(point[0] * MM, point[1] * MM, point[2] * MM).project(camera);
        return [(v.x + 1) / 2, (1 - v.y) / 2];
      },
    };
    return () => {
      scene.onAfterRender = () => {};
    };
  }, [camera, scene, raycaster, pendingTs, latency, pickRef, sectionRef]);

  // The agent's picture of the view: render the current frame, then read the canvas.
  useEffect(
    () =>
      view.attachCapture(() => {
        gl.render(scene, camera);
        return canvasToPng(gl.domElement);
      }),
    [view, gl, scene, camera],
  );

  useFrame((_, delta) => {
    if (navInput.current.momentum) {
      nav.current = coast(nav.current, navInput.current, Math.min(delta, 0.05) * 1000);
      invalidate(); // keep coasting
    }
    const target = nav.current;
    if (!target) return;
    // After an idle spell the first delta is long; cap it so the camera still eases instead of jumping.
    const k = 1 - Math.exp((-Math.min(delta, 0.05) * 1000) / EASE_MS);
    const prev = eased.current ?? target;
    const dAz = wrap180(target.azimuth - prev.azimuth);
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
    const near = SETTLED.distance * target.distance;
    const arrived =
      Math.abs(wrap180(target.azimuth - next.azimuth)) < SETTLED.degrees &&
      Math.abs(target.elevation - next.elevation) < SETTLED.degrees &&
      Math.abs(target.distance - next.distance) < near &&
      next.target.every((v, i) => Math.abs(v - (target.target[i] ?? 0)) < near);
    if (!arrived) invalidate(); // keep easing
    view.setCamera({
      azimuth: next.azimuth,
      elevation: next.elevation,
      distance: next.distance / MM,
      target: [next.target[0] / MM, next.target[1] / MM, next.target[2] / MM],
    });
    camera.position.set(...cameraPosition(next));
    camera.lookAt(...next.target);
  });
  return null;
}

/** The viewer's own light: from the south-west, high, as a default that reads the model's forms well. */
const DEFAULT_LIGHT: [number, number, number] = [-40, -60, 90];
const DEFAULT_INTENSITY = 1.6;
/** How far away (metres) the sun's light is placed: beyond the model, inside the shadow camera's reach. */
const SUN_DISTANCE = 120;

/**
 * The directional light. During a sun study it comes from where the sun is (north is +Y); it is moved at once when a
 * study sets it, so a capture taken right after already has its shadows.
 */
function SunLight({ view }: { view: ViewLink }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const { invalidate } = useThree();
  useEffect(() => {
    const apply = () => {
      const current = light.current;
      if (!current) return;
      const sun = view.sun;
      if (sun) {
        const [x, y, z] = sunLightDirection(sun);
        current.position.set(-x * SUN_DISTANCE, -y * SUN_DISTANCE, -z * SUN_DISTANCE);
        current.intensity = sun.altitude > 0 ? 1.8 : 0;
      } else {
        current.position.set(...DEFAULT_LIGHT);
        current.intensity = DEFAULT_INTENSITY;
      }
      current.updateMatrixWorld();
      invalidate();
    };
    apply();
    return view.onSun(apply);
  }, [view, invalidate]);
  return (
    <directionalLight
      ref={light}
      position={DEFAULT_LIGHT}
      intensity={DEFAULT_INTENSITY}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-60}
      shadow-camera-right={60}
      shadow-camera-top={60}
      shadow-camera-bottom={-60}
      shadow-camera-far={300}
    />
  );
}

export function Viewer({
  client,
  bus,
  latency,
  tools,
  view,
  askAgent,
  gestures,
  markers = [],
  children,
}: {
  client: SceneClient;
  bus: InputBus;
  /** Gesture-to-render latency, shared with the Detection card. */
  latency: LatencyTracker;
  tools: ToolController;
  /** The agent's view of what the user sees and points at. */
  view: ViewLink;
  /** Opens the agent panel for a request ("Ask agent" in the palette); returns why it cannot, or null. */
  askAgent: () => string | null;
  /** What each gesture does (the user's settings) and how gestures reach the agent. */
  gestures: RouterOptions;
  /** Elements captured while the user speaks, numbered in this order. */
  markers?: string[];
  /** HUD panels over the model (the agent panel); inside the viewer, so the hand can press their buttons. */
  children?: React.ReactNode;
}) {
  const software = useMemo(isSoftwareRenderer, []);
  const scene = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const toolState = useSyncExternalStore(tools.subscribe, tools.getSnapshot);
  const sun = useSyncExternalStore(view.onSun, () => view.sun);
  // Picking another tool ends a sun study: the viewer's own light returns.
  const studiedTool = useRef(toolState.activeId);
  useEffect(() => {
    if (studiedTool.current !== toolState.activeId) view.setSun(null);
    studiedTool.current = toolState.activeId;
  }, [toolState.activeId, view]);
  const [colors, setColors] = useState<Colors>(readColors);
  const nav = useRef<Turntable>({ target: [20, 15, 3], azimuth: 305, elevation: 32, distance: 70 });
  const navInput = useRef(initialInput());
  const pendingTs = useRef<number | null>(null);
  const pickRef = useRef<Picking>(noPicking);
  const sectionRef = useRef<number | null>(null);
  sectionRef.current = toolState.overlay.sectionMm;
  const handAspect = useRef(4 / 3);
  const lastMouse = useRef<Point2 | null>(null);
  const invalidateRef = useRef<() => void>(() => {});
  const rendersRef = useRef<() => number>(() => 0);
  const framed = useRef(false);
  const navigating = useRef(false);
  const [pointer, setPointer] = useState<Point2 | null>(null);
  const [engaged, setEngaged] = useState(bus.engaged);
  const [overButton, setOverButton] = useState(false);
  const [secondaryPointer, setSecondaryPointer] = useState<Point2 | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [p90, setP90] = useState<number | null>(null);
  const [projectPath, setProjectPath] = useState("");
  const [openingProject, setOpeningProject] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const askAgentRef = useRef(askAgent);
  askAgentRef.current = askAgent;

  useEffect(() => view.setPointed(hoverId), [view, hoverId]);
  // Where the hand pointer meets the ground, for a spoken "here".
  const pointerRef = useRef(pointer);
  pointerRef.current = pointer;
  useEffect(
    () =>
      view.attachGround(() => {
        const at = pointerRef.current;
        return at ? pickRef.current.ground(at[0], at[1], 0) : null;
      }),
    [view],
  );

  // Follow theme changes.
  useEffect(() => {
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const refresh = () => setColors(readColors());
    scheme.addEventListener("change", refresh);
    return () => scheme.removeEventListener("change", refresh);
  }, []);

  // Scene bounds in millimetres, for tools (the section range).
  const boundsMm = useMemo(() => {
    const geometries = Object.values(scene.doc?.elements ?? {}).map((e) =>
      elementGeometry(e, scene.doc?.levels ?? []),
    );
    const { min, max } = sceneBounds(geometries);
    for (const g of geometries) g.dispose();
    const mm = (v: [number, number, number]): Point3Mm => [v[0] / MM, v[1] / MM, v[2] / MM];
    return { min: mm(min), max: mm(max) };
  }, [scene.doc]);
  const boundsRef = useRef(boundsMm);
  boundsRef.current = boundsMm;

  /** The section outline's corners as viewer positions, or none without a section. */
  const sectionOutlineOnScreen = useCallback((): Point2[] => {
    const height = tools.getSnapshot().overlay.sectionMm;
    if (height === null) return [];
    const { min, max } = boundsRef.current;
    const pad = SECTION_PAD_MM;
    const corners: Point3Mm[] = [
      [min[0] - pad, min[1] - pad, height],
      [max[0] + pad, min[1] - pad, height],
      [max[0] + pad, max[1] + pad, height],
      [min[0] - pad, max[1] + pad, height],
    ];
    return corners.map((c) => pickRef.current.project(c));
  }, [tools]);

  // Frame the model the first time a scene arrives.
  useEffect(() => {
    if (!scene.doc || framed.current) return;
    const geometries = Object.values(scene.doc.elements).map((e) =>
      elementGeometry(e, scene.doc?.levels ?? []),
    );
    const { min, max } = sceneBounds(geometries);
    for (const g of geometries) g.dispose();
    nav.current = frameBox(min, max);
    invalidateRef.current();
    framed.current = true;
  }, [scene.doc]);

  // Tools act on the scene through the same client as everything else, and see the view through picking.
  useEffect(() => {
    tools.attach({
      doc: () => client.getSnapshot().doc,
      apply: (label, ops) => void client.apply(label, ops),
      undo: () => void client.undo(),
      redo: () => void client.redo(),
      select: (ids) => client.select(ids),
      // Under a HUD panel the model is hidden from the hand, as it is from the mouse.
      pick: ([x, y]) => (overHud(wrapper.current, [x, y]) ? null : pickRef.current.hit(x, y)),
      ground: ([x, y], heightMm = 0) => pickRef.current.ground(x, y, heightMm),
      bounds: () => boundsRef.current,
      handToViewer,
      handAspect: () => handAspect.current,
      navigate: (event: GestureEvent, dragMode = "orbit") => {
        navInput.current.dragMode = dragMode;
        nav.current = navigate(nav.current, navInput.current, event);
        if (navInput.current.momentum) invalidateRef.current(); // a flick: start coasting
        if (movesCamera(event)) {
          invalidateRef.current();
          pendingTs.current = Math.max(pendingTs.current ?? 0, event.ts);
        }
        if (event.type === "pinch.drag.start" || event.type === "twohand.start") navigating.current = true;
        if (event.type === "pinch.drag.end" || event.type === "twohand.end" || event.type === "disengaged") {
          navigating.current = false;
        }
      },
      press: (at) => {
        const button = handButtonAt(wrapper.current, at);
        button?.click();
        return button !== null;
      },
      isButton: (at) => handButtonAt(wrapper.current, at) !== null,
      onSectionLine: (at) => {
        const corners = sectionOutlineOnScreen();
        const el = wrapper.current;
        if (corners.length === 0 || !el) return false;
        const px = (p: Point2): Point2 => [p[0] * el.clientWidth, p[1] * el.clientHeight];
        const q = px(at);
        return corners.some((c, i) => {
          const [a, b] = [px(c), px(corners[(i + 1) % corners.length] as Point2)];
          return distanceToSegment(q, a, b) <= SECTION_LINE_PX;
        });
      },
      askAgent: () => askAgentRef.current(),
    });
  }, [tools, client, sectionOutlineOnScreen]);

  // Hand input: the router sends each gesture to the palette, the active tool or navigation (never the bridge).
  useEffect(() => {
    const router = new InputRouter(tools.routerTargets, gestures);
    const offGestures = bus.onGestures((events) => {
      for (const event of events) router.handle(event);
    });
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let hoveredButton: HTMLButtonElement | null = null;
    const markButton = (button: HTMLButtonElement | null) => {
      if (button === hoveredButton) return;
      hoveredButton?.removeAttribute("data-hand-hover");
      button?.setAttribute("data-hand-hover", "");
      hoveredButton = button;
      setOverButton(button !== null);
    };
    const offPointer = bus.onPointer((sample) => {
      if (sample.aspect) handAspect.current = sample.aspect;
      if (!sample.position) {
        // Tracking often drops a hand for a frame or two: keep the pointer a moment rather than blink.
        hideTimer ??= setTimeout(() => {
          hideTimer = null;
          setPointer(null);
          setSecondaryPointer(null);
          setHoverId(null);
          markButton(null);
        }, POINTER_HOLD_MS);
        return;
      }
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      const at = handToViewer(sample.position);
      setPointer(at);
      setSecondaryPointer(sample.secondary ? handToViewer(sample.secondary) : null);
      // The pointer always shows where the hand is; hover and HUD buttons respond only while engaged.
      const button = bus.engaged ? handButtonAt(wrapper.current, at) : null;
      markButton(button);
      if (!bus.engaged || navigating.current || button || overHud(wrapper.current, at)) {
        setHoverId(null);
        return;
      }
      setHoverId(pickRef.current.id(at[0], at[1]));
      tools.hover(at);
    });
    const offEngaged = bus.onEngaged((value) => {
      setEngaged(value);
      if (!value) {
        setHoverId(null);
        markButton(null);
      }
    });
    return () => {
      offGestures();
      offPointer();
      offEngaged();
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [bus, tools, gestures]);

  // Mouse: a click goes to the active tool; a left drag goes to the tool if it takes it, else orbits; right or
  // middle drag pans; holding the right button still opens the palette; the wheel zooms.
  useEffect(() => {
    const el = wrapper.current?.querySelector("canvas");
    if (!el) return;
    const viewerAt = (x: number, y: number): Point2 => {
      const rect = el.getBoundingClientRect();
      return [(x - rect.left) / rect.width, (y - rect.top) / rect.height];
    };
    let drag: {
      x: number;
      y: number;
      button: number;
      moved: boolean;
      byTool: boolean;
      holdTimer: ReturnType<typeof setTimeout> | null;
    } | null = null;
    const down = (e: PointerEvent) => {
      navInput.current.momentum = null; // a click catches a coasting view
      const at = viewerAt(e.clientX, e.clientY);
      const start = { x: e.clientX, y: e.clientY, button: e.button, moved: false, byTool: false };
      drag = { ...start, holdTimer: null };
      if (e.button === 2) {
        drag.holdTimer = setTimeout(() => {
          if (!drag || drag.moved) return;
          tools.openPalette({ center: at, aspect: el.clientWidth / el.clientHeight }, "pointer");
        }, RIGHT_HOLD_MS);
      }
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const at = viewerAt(e.clientX, e.clientY);
      lastMouse.current = at;
      if (!drag) tools.hover(at);
      if (tools.paletteOpen) {
        tools.steerPalette(at);
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.abs(dx) + Math.abs(dy) <= 3) return;
        drag.moved = true;
        if (drag.holdTimer) clearTimeout(drag.holdTimer);
        if (drag.button === 0) drag.byTool = tools.dragStart(viewerAt(drag.x, drag.y));
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.byTool) {
        tools.drag(at);
        return;
      }
      if (drag.button === 0) nav.current = orbit(nav.current, -dx * 0.3, dy * 0.25);
      else nav.current = pan(nav.current, dx / el.clientHeight, -dy / el.clientHeight, FOV);
      invalidateRef.current();
    };
    const up = (e: PointerEvent) => {
      const at = viewerAt(e.clientX, e.clientY);
      if (drag?.holdTimer) clearTimeout(drag.holdTimer);
      if (tools.paletteOpen && e.button === 2) tools.releasePalette();
      else if (drag?.byTool) tools.dragEnd(at);
      else if (drag && !drag.moved && drag.button === 0) tools.tap(at);
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      navInput.current.momentum = null;
      nav.current = zoom(nav.current, Math.exp(e.deltaY * 0.001));
      invalidateRef.current();
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
  }, [tools]);

  // Keyboard (not while typing): Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo; hold Space for the palette at the
  // pointer; one key per tool; Enter and Escape answer a confirmation (Escape also closes the palette).
  useEffect(() => {
    const typing = (e: KeyboardEvent) =>
      (e.target as HTMLElement).closest("input, textarea, select") !== null;
    const keydown = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          client.undo();
        } else if ((k === "z" && e.shiftKey) || k === "y") {
          e.preventDefault();
          client.redo();
        }
        return;
      }
      if (e.altKey) return;
      if (e.key === " ") {
        e.preventDefault();
        const canvas = wrapper.current?.querySelector("canvas");
        if (!e.repeat && !tools.paletteOpen && canvas) {
          const aspect = canvas.clientWidth / canvas.clientHeight;
          tools.openPalette({ center: lastMouse.current ?? [0.5, 0.5], aspect }, "pointer");
        }
        return;
      }
      if (e.key === "Enter" && tools.getSnapshot().question) {
        e.preventDefault();
        tools.respond(true);
        return;
      }
      if (e.key === "Escape") {
        tools.cancel();
        view.setSun(null); // back to the viewer's own light after a sun study
        return;
      }
      const tool = !e.repeat && !e.shiftKey ? tools.registry.byShortcut(k) : undefined;
      if (tool) tools.choose(tool.id);
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.key === " " && tools.paletteOpen) tools.releasePalette();
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    };
  }, [client, tools, view]);

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
      // What a user can actually hit there: nothing under a HUD panel, as for the mouse and the hand.
      pick: (x, y) => (overHud(wrapper.current, [x, y]) ? null : pickRef.current.id(x, y)),
      latencyP90: () => latency.p90(),
      renders: () => rendersRef.current(),
      project: (point) => pickRef.current.project(point),
      sectionOutline: () => sectionOutlineOnScreen(),
      sun: () => view.sun,
      overSection: (x, y) =>
        overSectionPlane(
          {
            overlay: () => tools.getSnapshot().overlay,
            ground: ([gx, gy], heightMm = 0) => pickRef.current.ground(gx, gy, heightMm),
            bounds: () => boundsRef.current,
          },
          [x, y],
        ),
    };
    window.__AEX_TOOLS__ = tools;
    window.__AEX_INPUT__ = {
      gestures: (events) => bus.emitGestures(events),
      pointer: (position, secondary = null) =>
        bus.emitPointer({ position, secondary, ts: performance.timeOrigin + performance.now() }),
      engaged: (engaged) => bus.setEngaged(engaged),
    };
  }, [bus, client, latency, tools, sectionOutlineOnScreen, view]);

  // The hand pointer shows what a pinch would do here: press a button, steer the palette, grab the section, or the
  // active tool's own action (its icon).
  const activeIcon = tools.registry.get(toolState.activeId)?.icon ?? null;
  let pointerMode: string = toolState.activeId;
  if (!engaged) pointerMode = "idle";
  else if (toolState.palette) pointerMode = "palette";
  else if (overButton) pointerMode = "press";
  else if (toolState.overlay.sectionHover) pointerMode = "grab";
  let pointerGlyph =
    pointerMode === toolState.activeId && toolState.activeId !== "select" ? activeIcon : null;
  if (pointerMode === "grab") pointerGlyph = "M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4";

  const selection = new Set(scene.selection);
  const { overlay } = toolState;
  // A move preview applies only while the element is still as it was when the drag began.
  const previewOffset = (element: Element): [number, number] | null =>
    overlay.movePreview?.id === element.id && overlay.movePreview.from === JSON.stringify(element)
      ? overlay.movePreview.offsetMm
      : null;
  const selected = scene.doc && scene.selection[0] ? scene.doc.elements[scene.selection[0]] : undefined;
  const openProject = (e: FormEvent) => {
    e.preventDefault();
    if (projectPath.trim()) client.openProject(projectPath.trim());
    setOpeningProject(false);
  };

  return (
    <section
      className="viewer"
      ref={wrapper}
      aria-label="3D model"
      data-testid="viewer"
      data-tool={toolState.activeId}
      data-section-hover={toolState.overlay.sectionHover}
    >
      {sun && (
        <div className="sun-badge" data-testid="sun-study" data-hud>
          <span className="sun-dot" aria-hidden="true" />
          <span>
            <strong>Sun study</strong> {sun.label}
            <span className="muted">
              {" "}
              {sun.altitude > 0
                ? `${Math.round(sun.altitude)}° up, ${Math.round(sun.azimuth)}° from north`
                : "below the horizon"}
            </span>
          </span>
          <button
            type="button"
            className="sun-close"
            data-hand-press
            aria-label="End the sun study"
            title="End the sun study (Escape)"
            onClick={() => view.setSun(null)}
          >
            ×
          </button>
        </div>
      )}
      <Canvas
        frameloop="demand"
        shadows={!software}
        camera={{ fov: FOV, near: 0.1, far: 5000, position: [60, -40, 40] }}
        gl={{ antialias: !software, preserveDrawingBuffer: true }}
        dpr={software ? 1 : [1, 2]}
        data-renderer={software ? "software" : "gpu"}
      >
        <color attach="background" args={[colors.background]} />
        <hemisphereLight args={["#ffffff", "#b9b4a8", 1.1]} />
        <SunLight view={view} />
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
        {/* The ground catches the model's shadows (a sun study's long winter shadows land here). */}
        {!software && (
          <mesh position={[0, 0, -0.3]} receiveShadow>
            <planeGeometry args={[2000, 2000]} />
            <shadowMaterial opacity={0.22} />
          </mesh>
        )}
        {scene.doc &&
          Object.values(scene.doc.elements).map((element) => (
            <ElementMesh
              key={element.id}
              element={element}
              doc={scene.doc as SceneDocument}
              colors={colors}
              selected={selection.has(element.id)}
              hovered={hoverId === element.id}
              marked={overlay.marked === element.id}
              offsetMm={previewOffset(element)}
              sectionMm={overlay.sectionMm}
            />
          ))}
        <SectionClipping heightMm={overlay.sectionMm} version={scene.doc} />
        {overlay.sectionMm !== null && (
          <SectionPlane
            heightMm={overlay.sectionMm}
            bounds={boundsMm}
            color={colors.selected}
            hovered={overlay.sectionHover}
          />
        )}
        {overlay.measure.length > 0 && <MeasureMarks points={overlay.measure} color={colors.selected} />}
        {markers.length > 0 && <ReferenceMarkers ids={markers} doc={scene.doc} />}
        <CameraRig
          nav={nav}
          navInput={navInput}
          pendingTs={pendingTs}
          latency={latency}
          pickRef={pickRef}
          sectionRef={sectionRef}
          invalidateRef={invalidateRef}
          rendersRef={rendersRef}
          view={view}
        />
      </Canvas>

      {secondaryPointer && (
        <div
          className="hand-pointer left-hand"
          data-testid="hand-pointer-secondary"
          style={{ left: `${secondaryPointer[0] * 100}%`, top: `${secondaryPointer[1] * 100}%` }}
          aria-hidden="true"
        />
      )}
      {pointer && (
        <div
          className="hand-pointer"
          data-testid="hand-pointer"
          data-mode={pointerMode}
          data-engaged={engaged}
          style={{ left: `${pointer[0] * 100}%`, top: `${pointer[1] * 100}%` }}
          aria-hidden="true"
        >
          {pointerGlyph && <ToolIcon path={pointerGlyph} size={14} />}
        </div>
      )}

      <ToolOverlays controller={tools} />
      <UndoStrip client={client} />

      {/* The project bar and the HUD panels stack down the model's left side. */}
      <div className="viewer-left">
        <div className="viewer-toolbar" data-hud>
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
              data-hand-press
            >
              Undo
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => client.redo()}
              disabled={!scene.canRedo}
              title="Redo (Ctrl+Shift+Z)"
              data-hand-press
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
        {children}
      </div>

      <div className="viewer-status" data-hud>
        <ActiveTool controller={tools} />
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
