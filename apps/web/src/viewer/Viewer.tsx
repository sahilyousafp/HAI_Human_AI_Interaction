import { DEFAULT_GESTURES } from "@hai/perception";
import {
  actionFor,
  DEFAULT_BINDINGS,
  DRAWING_AIDS,
  type Element,
  type GestureEvent,
  type Hand,
  type Point2,
  type Point3Mm,
  type Ring,
  type SceneDocument,
  type SunSetting,
} from "@hai/protocol";
import type { MeshPart } from "@hai/scene";
import {
  elementBounds,
  importedPlacement,
  ORTHO_VIEWS,
  type Projector,
  sunLightDirection,
  type ViewMode,
  viewMatches,
  workPlane,
} from "@hai/scene";
import { Edges, Grid, OrthographicCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  createContext,
  type FormEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { canvasToPng, type ViewLink } from "../agent/view-link.ts";
import { ContextLayer } from "../context/ContextLayer.tsx";
import type { ContextState } from "../context/context-client.ts";
import { contextExtent } from "../context/context-geometry.ts";
import { ExportReport, SaveAs3dmButton } from "../export/ExportControls.tsx";
import type { ProjectExporter } from "../export/exporter.ts";
import { isSoftwareRenderer } from "../gpu.ts";
import { ImportButton, ImportDropZone, ImportReport } from "../import/ImportControls.tsx";
import type { ModelImporter } from "../import/importer.ts";
import type { ModelAssets } from "../import/model-assets.ts";
import { handPointer, viewerToHand } from "../input/hand-mapping.ts";
import { grabScroll } from "../input/hand-scroll.ts";
import type { InputBus } from "../input/input-bus.ts";
import {
  type HandSnap,
  NO_SNAP,
  type SnapControl,
  snappedPoint,
  stepHandSnap,
} from "../input/pointer-snap.ts";
import { GeneratedPanel } from "../panel/GeneratedPanel.tsx";
import type { PanelClient } from "../panel/panel-client.ts";
import { MirrorLayer } from "../rhino/MirrorLayer.tsx";
import type { RhinoMirror } from "../rhino/rhino-mirror.ts";
import { useMirrorVersion } from "../rhino/use-mirror-version.ts";
import type { SceneClient, SceneState } from "../scene/scene-client.ts";
import type { DrawingAidsStore } from "../settings/drawing-aids.ts";
import type { FeatureFlags } from "../settings/feature-flags.ts";
import { overSectionPlane, SECTION_PAD_MM } from "../tools/builtin.ts";
import { ConstraintsPanel } from "../tools/ConstraintsPanel.tsx";
import type { PointerSource, ToolController } from "../tools/controller.ts";
import { InputRouter, type RouterOptions } from "../tools/input-router.ts";
import { ActiveTool, ToolIcon, ToolOverlays, UndoStrip } from "../tools/ToolOverlays.tsx";
import type { Hit } from "../tools/types.ts";
import type { VoiceInput, VoiceState } from "../voice/voice-input.ts";
import { SUN_DISTANCE, takeShots, USER_ONLY } from "./agent-shot.ts";
import { type CameraMarker, CameraMarkers } from "./camera-markers.tsx";
import { elementGeometry, MM, modelGeometry, radians, sceneBounds } from "./geometry.ts";
import type { LatencyTracker } from "./latency.ts";
import { coast, initialInput, movesCamera, type NavigationInput, navigate } from "./navigation.ts";
import {
  ClaimBoxes,
  NO_OWNERS,
  OWNER_TINT,
  type OwnerDisplay,
  OwnerDisplayContext,
  tint,
  useOwnerDisplay,
  useWear,
  type Wear,
  wornBy,
} from "./owner-display.tsx";
import { nearestModel, type SnapCandidate, snapRadius } from "./snap-pick.ts";
import {
  HeldPoints,
  HeldTargetMark,
  MeasureMarks,
  ReferenceMarkers,
  ReferenceMarks,
  SectionClipping,
  SectionPlane,
  SnapMarker,
} from "./ToolScene.tsx";
import { cameraPosition, frameBox, orbit, pan, type Turntable, zoom } from "./turntable.ts";
import { ViewCube } from "./ViewCube.tsx";
import { between, resolveView, VIEW_ANIMATION_MS } from "./view-request.ts";
import type { Visibility } from "./visibility.ts";

const FOV = 45;
const NO_MARKERS: CameraMarker[] = [];
const NO_CONTEXT: ContextState = { items: [], stale: false, credits: [] };
/** The pan pointer's icon: arrows in the four directions. */
const PAN_ICON = "M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3";
/** A microphone: the hand holding a long pinch is listening. */
const MIC_ICON = "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3";
/** A still pinch shows its progress toward a long pinch only after this long, so a tap never flashes a ring. */
const HOLD_SHOWN_AFTER_MS = 150;
const VOICE_OFF: VoiceState = { phase: "off" };
/** What the chip beside a holding hand says when the microphone fails (the agent panel says how to fix it). */
const MIC_PROBLEM = {
  denied: "Microphone blocked",
  "not-found": "No microphone",
  failed: "Microphone failed",
} as const;
const NO_POINTS: Point3Mm[] = [];
const NO_VOICE = { subscribe: () => () => {}, getSnapshot: () => VOICE_OFF };

/** What the chip beside a holding hand says, for each phase of its request; null shows no chip. */
function heldChipText(state: VoiceState, listening: boolean): string | null {
  switch (state.phase) {
    case "starting":
      return "Starting the microphone...";
    case "listening":
      return state.speaking
        ? "Listening. Point at what you mean."
        : listening
          ? "Listening. Speak now."
          : null;
    case "transcribing":
      return "Writing it down...";
    case "sent":
      return "Sent - shake to stop";
    case "stopped":
      return "Stopped";
    case "picked":
      return state.ran ? state.tool : `${state.tool} picked`;
    case "error":
      return MIC_PROBLEM[state.error];
    default:
      return null;
  }
}
/** Camera easing time constant: smooths hand jitter without adding visible lag. */
/**
 * The camera eases toward where gestures put it. Hand input arrives about every 40 ms (one tracking frame); easing
 * over a little more than two of those makes it glide between samples instead of stepping, at the cost of a few
 * tens of milliseconds of lag on large moves (the first rendered change still follows the gesture at once).
 */
const EASE_MS = 100;
/** While a fist holds the view the camera follows the hand closer, so it does not trail or spring after it. */
const GRAB_EASE_MS = 50;
/** The eased camera counts as arrived (and rendering stops) within this of its target. */
const SETTLED = { degrees: 0.01, distance: 0.001 };
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

/** What a hand can press, like a click: buttons, links, checkboxes and their labels, and anything marked so. */
const PRESSABLE =
  'button, a[href], summary, label, input[type="checkbox"], input[type="radio"], [data-hand-press]';

/** Whether a ring may open by mouse or keyboard: rings are switched on. */
function ringAllowed(features: FeatureFlags): boolean {
  return features.on("toolRings");
}

/** A DOM element (the scene's `Element` type shadows the DOM's name in this file). */
type DomElement = globalThis.Element;

/** The page element at a viewer position (it may lie outside the viewer, over the sidebar). */
function elementAt(wrapper: HTMLElement | null, [x, y]: Point2): DomElement | null {
  if (!wrapper) return null;
  const rect = wrapper.getBoundingClientRect();
  return document.elementFromPoint(rect.left + x * rect.width, rect.top + y * rect.height);
}

/**
 * The control a pinch would press at a viewer position, if any: hands press what the mouse clicks. A label counts
 * only for a checkbox or radio button (a click on it toggles that); dropdowns and text fields need the mouse.
 */
function pressableAt(wrapper: HTMLElement | null, at: Point2): HTMLElement | null {
  return pressable(elementAt(wrapper, at)?.closest<HTMLElement>(PRESSABLE) ?? null);
}

/** The element itself when a hand may press it: it is not disabled, and a label counts only for a toggle. */
function pressable(target: HTMLElement | null): HTMLElement | null {
  if (!target || (target as HTMLButtonElement | HTMLInputElement).disabled) return null;
  if (target instanceof HTMLLabelElement) {
    const control = target.control;
    const toggles =
      control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio");
    return toggles && !control.disabled ? target : null;
  }
  return target;
}

/** Every control on screen that a hand could press, with its rectangle (px): what a pointer can snap to. */
function snapControls(): Array<SnapControl<HTMLElement>> {
  const controls: Array<SnapControl<HTMLElement>> = [];
  for (const el of document.querySelectorAll<HTMLElement>(PRESSABLE)) {
    if (!pressable(el) || el.closest("[inert]") || !el.checkVisibility({ visibilityProperty: true }))
      continue;
    const { left, top, right, bottom, width, height } = el.getBoundingClientRect();
    if (width === 0 || height === 0 || right < 0 || bottom < 0 || left > innerWidth || top > innerHeight) {
      continue;
    }
    controls.push({ key: el, rect: { left, top, right, bottom } });
  }
  return controls;
}

/** Whether a control is the topmost thing at its own middle (so a panel over it does not hide it from a snap). */
function exposed({ key, rect }: SnapControl<HTMLElement>): boolean {
  const [x, y] = snappedPoint([(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2], rect);
  const top = document.elementFromPoint(x, y);
  return top !== null && (key === top || key.contains(top));
}

/** The nearest scrolled area at a viewer position that has more to show (a pinch-drag there scrolls it). */
function scrollableAt(wrapper: HTMLElement | null, at: Point2): HTMLElement | null {
  for (let el = elementAt(wrapper, at); el && el !== document.body; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
  }
  return null;
}

/**
 * Whether a viewer position is off the model for picking: anything on top of the model's canvas there (a panel, the
 * camera view, the settings) hides it from the hand as from the mouse, and so does being outside the viewer.
 */
function overHud(wrapper: HTMLElement | null, at: Point2): boolean {
  if (!wrapper) return false;
  if (at[0] < 0 || at[0] > 1 || at[1] < 0 || at[1] > 1) return true;
  const el = elementAt(wrapper, at);
  return !(el instanceof HTMLCanvasElement && wrapper.contains(el));
}

declare global {
  interface Window {
    /** Dev builds only: viewer state for end-to-end tests. */
    __HAI_VIEWER__?: {
      camera(): Turntable;
      meshCount(): number;
      /** The element a click or tap at this viewer position would hit (null under a HUD panel). */
      pick(x: number, y: number): string | null;
      latencyP90(): number | null;
      /** The element lit up under the hand pointer now (a pinch there would select it), or null. */
      hovered(): string | null;
      /** What an element or mirrored object is drawn with now: its colour, outline and highlight. */
      wear(id: string): Wear | null;
      /** The claims drawn as boxes. */
      claimBoxes(): string[];
      /** The agent cameras drawn as markers, as "agent/name". */
      cameraMarkers(): string[];
      /** The city context: how many items it holds by kind, and whether the user's view shows it. */
      context(): { buildings: number; trees: number; rasters: number; visible: boolean; stale: boolean };
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
      /** The pinch point (camera frame) that puts a hand's pointer at a viewer position: the inverse mapping. */
      handAt(x: number, y: number): Point2;
    };
    /** Dev builds only: the tool controller, for end-to-end tests. */
    __HAI_TOOLS__?: ToolController;
    /** Dev builds only: inject hand input exactly as the tracker would. */
    __HAI_INPUT__?: {
      gestures(events: GestureEvent[]): void;
      /** The right hand's pinch point, and the left hand's (null where that hand is not in view). */
      /** `closing`: the hands whose fingers are closing into a pinch (their pointers hold what they snapped to). */
      pointer(right: Point2 | null, left?: Point2 | null, closing?: Partial<Record<Hand, boolean>>): void;
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
  handLeft: string;
  handRight: string;
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
    handLeft: v("--hand-left"),
    handRight: v("--hand-right"),
  };
}

function projectStatusText(scene: SceneState): string {
  if (scene.projectError) return scene.projectError;
  if (scene.savedAt) return `Saved ${new Date(scene.savedAt).toLocaleTimeString()}`;
  if (scene.project) return "All changes saved";
  return "Sample (not saved)";
}

interface HandPointerState {
  /** Viewer position (0..1 across the viewer; beyond it over the sidebar). */
  at: Point2;
  /** Where it is drawn on screen, px. */
  client: Point2;
  /** Over a control a pinch would press. */
  overControl: boolean;
  /** The focus hand: it drives hover in the model and what "this" and "here" mean. */
  focus: boolean;
  /** A still pinch on its way to a long pinch: how far, 0..1; null otherwise. */
  hold: number | null;
}

/** The imported geometry the viewer draws; shared by every element mesh below it. */
const ModelAssetsContext = createContext<ModelAssets | null>(null);

/** The triangles of an imported element once its asset has arrived (it is fetched the first time it is needed). */
function useModelPart(element: Element): MeshPart | null {
  const assets = useContext(ModelAssetsContext);
  const asset = element.type === "imported" ? element.asset : null;
  const part = element.type === "imported" ? element.part : 0;
  useEffect(() => {
    if (assets && asset) assets.ensure(asset);
  }, [assets, asset]);
  useSyncExternalStore(assets?.subscribe ?? (() => () => {}), assets?.getVersion ?? (() => 0));
  return (asset && assets?.parts(asset)?.[part]) || null;
}

/** An imported element's own display colour, unless it is drawn in a state colour (selected, hovered, marked). */
function importedColor(element: Element): string | undefined {
  return element.type === "imported" ? element.color : undefined;
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
  draft = false,
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
  /** Not created yet (a create tool or Copy is placing it): see-through, and never picked. */
  draft?: boolean;
}) {
  const mesh = useModelPart(element);
  // An imported model is drawn from its asset's own arrays (millimetres), scaled and placed by the mesh; everything
  // else, and a model whose triangles have not arrived (or are gone), from geometry built in metres.
  const model = useMemo(() => (mesh ? modelGeometry(mesh) : null), [mesh]);
  const built = useMemo(
    () => (model ? null : elementGeometry(element, doc.levels)),
    [model, element, doc.levels],
  );
  const geometry = (model ?? built) as THREE.BufferGeometry;
  useEffect(() => () => geometry.dispose(), [geometry]);
  // The model's triangles are in the asset's own millimetres: its placement turns, scales and moves them.
  const placement = useMemo(
    () => (model && element.type === "imported" ? importedPlacement(element) : null),
    [model, element],
  );
  const topMm = useMemo(() => {
    geometry.computeBoundingBox();
    const top = geometry.boundingBox?.max.z ?? 0;
    return placement ? placement.offset[2] + placement.scale * top : top / MM;
  }, [geometry, placement]);
  // Edge lines clip per segment by its first point, so a cut element's vertical edges would stick up through the
  // section; cut elements are drawn without edges instead.
  // Imported models have no edge lines: finding them costs time proportional to the triangles (a model of a million
  // triangles cannot afford it), and on a detailed model they clutter the surface. Their normals show the forms.
  // A line is a thin tube: edge lines on it would only be noise.
  const showEdges =
    (sectionMm === null || topMm <= sectionMm) && element.type !== "imported" && element.type !== "line";
  const { owner: ownerColor, glow } = useOwnerDisplay(element.id, element.tags);
  const base = element.type === "massing" ? colors.massing : (importedColor(element) ?? colors.element);
  const ownerAmount = element.type === "imported" ? 0.4 : OWNER_TINT;
  // What an agent's picture shows: the owner's tint, without the user's hover, selection and deletion mark.
  const clean = ownerColor ? tint(base, ownerColor, ownerAmount) : base;
  let color = base;
  // The owner's colour is a hint under the state colours: hover and selection replace it, the deletion mark too.
  const owner = ownerColor && !selected && !marked ? ownerColor : null;
  if (owner && !hovered) color = tint(color, owner, ownerAmount);
  if (hovered) color = colors.hover;
  if (selected) color = colors.selected;
  if (marked) color = colors.risk;
  useWear(element.id, color, showEdges ? (glow ?? owner) : null, glow);
  const offset: [number, number, number] = offsetMm ? [offsetMm[0] * MM, offsetMm[1] * MM, 0] : [0, 0, 0];
  // A model sits at its placement, and its millimetres become metres by scale.
  const placed: [number, number, number] = placement
    ? [
        offset[0] + placement.offset[0] * MM,
        offset[1] + placement.offset[1] * MM,
        offset[2] + placement.offset[2] * MM,
      ]
    : offset;
  const scale = model ? MM * (placement?.scale ?? 1) : 1;
  const turned: [number, number, number] = [0, 0, radians(placement?.rotationDeg ?? 0)];
  if (draft) {
    return (
      <mesh
        geometry={geometry}
        position={placed}
        rotation={turned}
        scale={scale}
        raycast={() => null}
        renderOrder={1}
      >
        <meshStandardMaterial color={colors.selected} transparent opacity={0.55} depthWrite={false} />
        {element.type !== "line" && <Edges threshold={20} color={colors.selected} />}
      </mesh>
    );
  }
  return (
    <mesh
      geometry={geometry}
      position={placed}
      rotation={turned}
      scale={scale}
      castShadow
      receiveShadow
      userData={{ elementId: element.id, cleanColor: clean }}
    >
      <meshStandardMaterial
        color={color}
        roughness={0.9}
        metalness={0}
        flatShading={model !== null}
        {...(glow ? { emissive: glow, emissiveIntensity: 0.6 } : {})}
      />
      {showEdges && <Edges threshold={20} color={glow ?? owner ?? colors.edge} />}
    </mesh>
  );
}

/** Scene-space picking helpers the camera rig fills in (they need the live camera). */
interface Picking {
  id(x: number, y: number): string | null;
  hit(x: number, y: number): Hit | null;
  /** Like `hit`, but a pointer that hits nothing snaps to the nearest model within reach (a hand's imprecise pinch). */
  near(x: number, y: number): Hit | null;
  ground(x: number, y: number, heightMm: number): Point3Mm | null;
  /** Where the view ray meets the vertical plane `x = at` (a left or right view) or `y = at` (front or back), mm. */
  workPoint(x: number, y: number, plane: "xz" | "yz", atMm: number): Point3Mm | null;
  project(point: Point3Mm): Point2;
  /** Where a scene point (mm) is on screen in px, for a view of this size; false when it is behind the camera. */
  projector(width: number, height: number): Projector;
}

const noPicking: Picking = {
  id: () => null,
  hit: () => null,
  near: () => null,
  ground: () => null,
  workPoint: () => null,
  project: () => [0, 0],
  projector: () => () => false,
};

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
  modeRef,
  onLeaveView,
  cubeRef,
}: {
  /** Which view the camera is in, and the way out once the user orbits away from an orthographic one. */
  modeRef: React.RefObject<ViewMode>;
  onLeaveView: () => void;
  /** Turns the view cube with the camera. */
  cubeRef: React.RefObject<((azimuth: number, elevation: number) => void) | null>;
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
  const { camera, scene, raycaster, invalidate, gl, size } = useThree();
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
    /** The nearest model within a few centimetres on screen of a pointer that hit nothing. */
    const near = (x: number, y: number): Hit | null => {
      const direct = hit(x, y);
      if (direct) return direct;
      const cut = sectionRef.current;
      const candidates: SnapCandidate[] = [];
      const centres = new Map<string, Point3Mm>();
      const corner = new THREE.Vector3();
      const box = new THREE.Box3();
      scene.traverse((object) => {
        const id = object.userData.elementId;
        const mesh = object as THREE.Mesh;
        if (typeof id !== "string" || !mesh.isMesh || !mesh.visible) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const local = mesh.geometry.boundingBox;
        if (!local) return;
        box.copy(local).applyMatrix4(mesh.matrixWorld);
        if (cut !== null && box.min.z / MM > cut + 1) return; // hidden above the section
        const corners: Point2[] = [];
        for (let i = 0; i < 8; i++) {
          corner.set(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z,
          );
          const depth = corner.clone().applyMatrix4(camera.matrixWorldInverse).z;
          if (depth >= 0) return; // part of it is behind the camera: its outline on screen is not meaningful
          corner.project(camera);
          corners.push([((corner.x + 1) / 2) * size.width, ((1 - corner.y) / 2) * size.height]);
        }
        const centre = box.getCenter(new THREE.Vector3());
        candidates.push({ id, corners, depth: centre.distanceTo(camera.position) });
        centres.set(id, [centre.x / MM, centre.y / MM, centre.z / MM]);
      });
      const id = nearestModel(candidates, [x * size.width, y * size.height], snapRadius(size.height));
      const point = id ? centres.get(id) : undefined;
      return id && point ? { elementId: id, point } : null;
    };
    pickRef.current = {
      hit,
      near,
      id: (x, y) => hit(x, y)?.elementId ?? null,
      ground: (x, y, heightMm) => {
        // A side view looks along the ground: the plan has no point under the pointer there.
        if (workPlane(modeRef.current) !== "xy") return null;
        cast(x, y);
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -heightMm * MM);
        const at = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        return at ? [at.x / MM, at.y / MM, heightMm] : null;
      },
      workPoint: (x, y, plane, atMm) => {
        cast(x, y);
        // The plane stands square to the Y axis for a front or back view, to the X axis for a left or right one.
        const normal = plane === "xz" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const at = raycaster.ray.intersectPlane(new THREE.Plane(normal, -atMm * MM), new THREE.Vector3());
        return at ? [at.x / MM, at.y / MM, at.z / MM] : null;
      },
      project: (point) => {
        const v = new THREE.Vector3(point[0] * MM, point[1] * MM, point[2] * MM).project(camera);
        return [(v.x + 1) / 2, (1 - v.y) / 2];
      },
      projector: (width, height) => {
        // The camera's view and projection as one matrix, so each point costs a few multiplications and no allocation.
        camera.updateMatrixWorld();
        const e = new THREE.Matrix4().multiplyMatrices(
          camera.projectionMatrix,
          camera.matrixWorldInverse,
        ).elements;
        return (p, out) => {
          const [x, y, z] = [p[0] * MM, p[1] * MM, p[2] * MM];
          const w = (e[3] as number) * x + (e[7] as number) * y + (e[11] as number) * z + (e[15] as number);
          if (w <= 0) return false;
          const cx = (e[0] as number) * x + (e[4] as number) * y + (e[8] as number) * z + (e[12] as number);
          const cy = (e[1] as number) * x + (e[5] as number) * y + (e[9] as number) * z + (e[13] as number);
          out[0] = ((cx / w + 1) / 2) * width;
          out[1] = ((1 - cy / w) / 2) * height;
          return true;
        };
      },
    };
    return () => {
      scene.onAfterRender = () => {};
    };
  }, [camera, scene, raycaster, size, pendingTs, latency, pickRef, sectionRef, modeRef]);

  // The agent's picture of the view: render the current frame, then read the canvas.
  useEffect(
    () =>
      view.attachCapture(() => {
        gl.render(scene, camera);
        return canvasToPng(gl.domElement);
      }),
    [view, gl, scene, camera],
  );
  // Pictures from the agents' own cameras: off to the side, the user's frame drawn again before anything paints.
  useEffect(
    () => view.attachShots((request) => takeShots({ gl, scene, camera, fov: FOV }, request)),
    [view, gl, scene, camera],
  );

  useFrame((_, delta) => {
    if (navInput.current.momentum) {
      nav.current = coast(nav.current, navInput.current, Math.min(delta, 0.05) * 1000);
      invalidate(); // keep coasting
    }
    const target = nav.current;
    if (!target) return;
    // Orbiting (or framing, or the agent's view) away from an orthographic view returns to the perspective camera.
    if (modeRef.current !== "perspective" && !viewMatches(modeRef.current, target)) onLeaveView();
    // After an idle spell the first delta is long; cap it so the camera still eases instead of jumping.
    const k =
      1 - Math.exp((-Math.min(delta, 0.05) * 1000) / (navInput.current.grabbing ? GRAB_EASE_MS : EASE_MS));
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
    cubeRef.current?.(next.azimuth, next.elevation);
    const aspect = size.width / Math.max(1, size.height);
    const ortho = camera as THREE.OrthographicCamera;
    const perspective = camera as THREE.PerspectiveCamera;
    if (ortho.isOrthographicCamera) {
      // The same height at the target as the perspective view has, so switching keeps what is framed.
      const half = next.distance * Math.tan((FOV * Math.PI) / 360);
      [ortho.left, ortho.right, ortho.top, ortho.bottom] = [-half * aspect, half * aspect, half, -half];
      ortho.updateProjectionMatrix();
    } else if (perspective.isPerspectiveCamera && Math.abs(perspective.aspect - aspect) > 1e-6) {
      perspective.aspect = aspect; // the window may have been resized while the orthographic camera was in use
      perspective.updateProjectionMatrix();
    }
  });
  return null;
}

/** The viewer's own light: from the south-west, high, as a default that reads the model's forms well. */
const DEFAULT_LIGHT: [number, number, number] = [-40, -60, 90];
const DEFAULT_INTENSITY = 1.6;

/**
 * The directional light. During a sun study it comes from where the sun is (north is +Y); it is moved at once when a
 * study sets it, so a capture taken right after already has its shadows.
 */
function SunLight({ view, extent }: { view: ViewLink; extent: number }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const { invalidate } = useThree();
  // The shadow map covers the model; with city context around it, enough to take in the neighbours' shadows too.
  const half = Math.min(300, Math.max(60, extent * 1.2));
  useEffect(() => {
    const current = light.current;
    if (!current) return;
    const camera = current.shadow.camera;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.far = Math.max(300, half * 2.5);
    camera.updateProjectionMatrix();
    current.shadow.mapSize.set(half > 100 ? 4096 : 2048, half > 100 ? 4096 : 2048);
    current.shadow.map?.dispose();
    current.shadow.map = null;
    invalidate();
  }, [half, invalidate]);
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
      shadow-mapSize={half > 100 ? [4096, 4096] : [2048, 2048]}
      shadow-camera-left={-half}
      shadow-camera-right={half}
      shadow-camera-top={half}
      shadow-camera-bottom={-half}
      shadow-camera-far={Math.max(300, half * 2.5)}
    />
  );
}

export function Viewer({
  client,
  bus,
  latency,
  tools,
  view,
  visibility,
  askAgent,
  gestures,
  features,
  aids,
  importer,
  exporter,
  modelAssets,
  panels,
  mirror,
  mirrorAssets,
  markers = [],
  voice,
  owners,
  cameraMarkers = NO_MARKERS,
  context = NO_CONTEXT,
  showContext = true,
  children,
}: {
  client: SceneClient;
  bus: InputBus;
  /** Gesture-to-render latency, shared with the Detection card. */
  latency: LatencyTracker;
  tools: ToolController;
  /** Which elements the user has hidden ("hide", "isolate"): not drawn, picked or snapped to. */
  visibility: Visibility;
  /** The agent's view of what the user sees and points at. */
  view: ViewLink;
  /** Opens the agent panel for a request ("Ask agent" in the palette); returns why it cannot, or null. */
  askAgent: () => string | null;
  /** What each gesture does (the user's settings) and how gestures reach the agent. */
  gestures: RouterOptions;
  /** Which features are switched on (Settings > Features). */
  features: FeatureFlags;
  /** Which drawing aids are switched on (Settings > Drawing aids). */
  aids: DrawingAidsStore;
  /** Brings a Rhino .3dm file into the project (the Import button and dropping a file). */
  importer: ModelImporter;
  /** Saves the open project as a Rhino .3dm file (the Save as 3dm button). */
  exporter: ProjectExporter;
  /** The imported models the viewer draws, fetched from the bridge as they are first needed. */
  modelAssets: ModelAssets;
  /** The generated panel the agent offered, and the preview its controls lay over the scene. */
  panels: PanelClient;
  /** Rhino's objects, drawn read-only beside the scene while Rhino is connected. */
  mirror: RhinoMirror;
  /** The meshes of Rhino's objects, fetched from the bridge as they are first needed. */
  mirrorAssets: ModelAssets;
  /** Elements captured while the user speaks, numbered in this order. */
  markers?: string[];
  /** Voice input: what a held pinch is listening to, shown beside the hand, and the points it rested on. */
  voice?: VoiceInput;
  /** Who owns which elements, and the claims to mark; absent: nothing is marked. */
  owners?: OwnerDisplay;
  /** The cameras agents placed, as small markers in the model (not in agents' own pictures). */
  cameraMarkers?: CameraMarker[];
  /** The city context (buildings, trees, ground data), drawn read-only beside the model. */
  context?: ContextState;
  /** Whether the user's view shows the context (agents' own pictures always do). */
  showContext?: boolean;
  /** HUD panels over the model (the agent panel); inside the viewer, so the hand can press their buttons. */
  children?: React.ReactNode;
}) {
  const software = useMemo(isSoftwareRenderer, []);
  const scene = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const hidden = useSyncExternalStore(visibility.subscribe, visibility.getSnapshot);
  // A generated panel's preview is laid over the scene for drawing only: tools and the bridge see the committed one.
  useSyncExternalStore(panels.subscribe, () => panels.getSnapshot().previewVersion);
  const shownDoc = panels.shownDoc(scene.doc);
  const toolState = useSyncExternalStore(tools.subscribe, tools.getSnapshot);
  const sun = useSyncExternalStore(view.onSun, () => view.sun);
  const featureState = useSyncExternalStore(features.subscribe, features.getSnapshot);
  const aidState = useSyncExternalStore(aids.subscribe, aids.getSnapshot);
  const modelVersion = useSyncExternalStore(modelAssets.subscribe, modelAssets.getVersion);
  // The count of documents that have arrived whole, to frame each once; the objects themselves are the layer's own.
  const rhinoSynced = useSyncExternalStore(mirror.subscribe, () => mirror.getSnapshot().synced);
  const mirrorVersion = useMirrorVersion(mirror, mirrorAssets);
  // The cut is applied again when elements change or a model's triangles arrive.
  const clipVersion = useMemo(
    () => ({ doc: shownDoc, modelVersion, mirrorVersion }),
    [shownDoc, modelVersion, mirrorVersion],
  );
  // Picking another tool ends a sun study: the viewer's own light returns.
  const studiedTool = useRef(toolState.activeId);
  useEffect(() => {
    if (studiedTool.current !== toolState.activeId) view.setSun(null);
    studiedTool.current = toolState.activeId;
  }, [toolState.activeId, view]);
  const [colors, setColors] = useState<Colors>(readColors);
  const nav = useRef<Turntable>({ target: [20, 15, 3], azimuth: 305, elevation: 32, distance: 70 });
  // Perspective, or one of six orthographic views (the view cube). Orbiting leaves an orthographic view.
  const [viewMode, setViewMode] = useState<ViewMode>("perspective");
  const viewModeRef = useRef<ViewMode>("perspective");
  const perspectiveView = useRef<Turntable | null>(null);
  const cubeRef = useRef<((azimuth: number, elevation: number) => void) | null>(null);
  const showView = useCallback((mode: ViewMode) => {
    const current = viewModeRef.current;
    if (mode === current) return;
    if (mode === "perspective") {
      // Back to the camera that was looking before, at whatever is framed now.
      const back = perspectiveView.current;
      if (back) nav.current = { ...nav.current, azimuth: back.azimuth, elevation: back.elevation };
      perspectiveView.current = null;
    } else {
      if (current === "perspective") perspectiveView.current = nav.current;
      nav.current = {
        ...nav.current,
        azimuth: ORTHO_VIEWS[mode].azimuth,
        elevation: ORTHO_VIEWS[mode].elevation,
      };
    }
    viewModeRef.current = mode;
    setViewMode(mode);
    invalidateRef.current();
  }, []);
  const leaveView = useCallback(() => {
    perspectiveView.current = null;
    viewModeRef.current = "perspective";
    setViewMode("perspective");
  }, []);
  const navInput = useRef(initialInput());
  const pendingTs = useRef<number | null>(null);
  const pickRef = useRef<Picking>(noPicking);
  const sectionRef = useRef<number | null>(null);
  sectionRef.current = toolState.overlay.sectionMm;
  const handAspect = useRef(4 / 3);
  const lastMouse = useRef<Point2 | null>(null);
  const invalidateRef = useRef<() => void>(() => {});
  const rendersRef = useRef<() => number>(() => 0);
  /** The project the view was last framed for (the path), so each opened project is framed once. */
  const framed = useRef<string | null | undefined>(undefined);
  const navigating = useRef(false);
  /** Per hand: it is a fist (a clutch), and its drag is moving the view by panning. Drives the pan pointer. */
  const [handShape, setHandShape] = useState<Partial<Record<Hand, { fist: boolean; panning: boolean }>>>({});
  const shapeOf = useCallback((hand: Hand, patch: Partial<{ fist: boolean; panning: boolean }>) => {
    setHandShape((all) => {
      const now = { fist: false, panning: false, ...all[hand] };
      return now.fist === (patch.fist ?? now.fist) && now.panning === (patch.panning ?? now.panning)
        ? all
        : { ...all, [hand]: { ...now, ...patch } };
    });
  }, []);
  /** Each visible hand's pointer: its viewer position, where it is on screen, and whether it is over a control. */
  const [pointers, setPointers] = useState<Partial<Record<Hand, HandPointerState>>>({});
  const [engaged, setEngaged] = useState(bus.engaged);
  const [stopArmed, setStopArmed] = useState(bus.stopArmed);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverIdRef = useRef<string | null>(null);
  hoverIdRef.current = hoverId;
  const ownersRef = useRef<OwnerDisplay>(owners ?? NO_OWNERS);
  ownersRef.current = owners ?? NO_OWNERS;
  const markersRef = useRef<CameraMarker[]>(cameraMarkers);
  markersRef.current = cameraMarkers;
  const contextRef = useRef({ context, showContext });
  contextRef.current = { context, showContext };
  const [p90, setP90] = useState<number | null>(null);
  const [projectPath, setProjectPath] = useState("");
  /** The folder form under the project bar: for opening a project or for starting a new one. */
  const [projectForm, setProjectForm] = useState<"open" | "new" | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const askAgentRef = useRef(askAgent);
  askAgentRef.current = askAgent;

  useEffect(() => view.setPointed(hoverId), [view, hoverId]);
  /** Pointers whose press began inside a generated panel's frame (their moves and release go into it). */
  const framePresses = useRef(new Set<PointerSource>());
  /** A viewer position as a point in the open panel's frame, px, kept inside it; null without a frame. */
  const inFrame = useCallback(
    (at: Point2): Point2 | null => {
      const frame = panels.frame?.element;
      const view = wrapper.current?.getBoundingClientRect();
      if (!frame || !view) return null;
      const box = frame.getBoundingClientRect();
      const x = view.left + at[0] * view.width - box.left;
      const y = view.top + at[1] * view.height - box.top;
      return [Math.min(box.width, Math.max(0, x)), Math.min(box.height, Math.max(0, y))];
    },
    [panels],
  );
  /** The control each hand's pointer is snapped to, if any (Settings > Features > Snap to buttons). */
  const snapTargets = useRef<Partial<Record<Hand, HTMLElement>>>({});
  /** The control a press from this source acts on: the one a hand is snapped to, else what is under the position. */
  const controlFor = useCallback((at: Point2, source?: PointerSource): HTMLElement | null => {
    const snapped = source && source !== "mouse" ? snapTargets.current[source] : undefined;
    if (snapped?.isConnected && pressable(snapped)) return snapped;
    return pressableAt(wrapper.current, at);
  }, []);
  // Where the focus hand's pointer meets the ground, for a spoken "here".
  const groundAtRef = useRef<Point2 | null>(null);
  useEffect(
    () =>
      view.attachGround(() => {
        const at = groundAtRef.current;
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

  // After an import, frame what it brought in as soon as its elements have arrived from the bridge.
  const framePending = useRef<string[] | null>(null);
  useEffect(
    () =>
      importer.onImported((ids) => {
        framePending.current = ids;
      }),
    [importer],
  );
  useEffect(() => {
    const ids = framePending.current;
    const doc = scene.doc;
    if (!ids || !doc || !ids.every((id) => doc.elements[id])) return;
    framePending.current = null;
    const geometries = ids.map((id) => elementGeometry(doc.elements[id] as Element, doc.levels));
    const { min, max } = sceneBounds(geometries);
    for (const g of geometries) g.dispose();
    nav.current = frameBox(min, max);
    invalidateRef.current();
  }, [scene.doc]);

  // Frame the model the first time a scene arrives, and again for each project that is opened; an empty project (a
  // new one) frames a stretch of ground around the origin.
  const framedPath = scene.project?.path ?? null;
  useEffect(() => {
    if (!scene.doc || framed.current === framedPath) return;
    const geometries = Object.values(scene.doc.elements).map((e) =>
      elementGeometry(e, scene.doc?.levels ?? []),
    );
    if (geometries.length === 0) {
      nav.current = frameBox([-15, -15, 0], [15, 15, 5]);
    } else {
      const { min, max } = sceneBounds(geometries);
      nav.current = frameBox(min, max);
    }
    for (const g of geometries) g.dispose();
    invalidateRef.current();
    framed.current = framedPath;
  }, [scene.doc, framedPath]);

  // Tools act on the scene through the same client as everything else, and see the view through picking.
  useEffect(() => {
    tools.attach({
      doc: () => client.getSnapshot().doc,
      hidden: () => visibility.getSnapshot(),
      apply: (label, ops) => void client.apply(label, ops),
      undo: () => void client.undo(),
      redo: () => void client.redo(),
      select: (ids) => {
        // A pick on a Rhino object selects it in Rhino (and what Rhino reports back is highlighted here); the HAI
        // selection is cleared so the two never show different things at once.
        const picked = ids.length > 0 && ids.every((id) => mirror.has(id));
        if (picked) {
          if (client.getSnapshot().selection.length > 0) client.select([]);
          mirror.select(ids);
        } else {
          client.select(ids);
          if (mirror.getSnapshot().selection.length > 0) mirror.select([]);
        }
      },
      // Under a HUD panel the model is hidden from the hand, as it is from the mouse.
      // A hand's pinch is rarely pixel-exact, so it snaps to the nearest model in reach; the mouse stays exact.
      pick: ([x, y], source) => {
        if (overHud(wrapper.current, [x, y])) return null;
        const snapping = source !== undefined && source !== "mouse" && features.on("snapToModels");
        return snapping ? pickRef.current.near(x, y) : pickRef.current.hit(x, y);
      },
      ground: ([x, y], heightMm = 0) => pickRef.current.ground(x, y, heightMm),
      // The camera, for matching snaps on screen: the view's size in px, and where a scene point is on it.
      screenSize: () => [wrapper.current?.clientWidth || 1, wrapper.current?.clientHeight || 1],
      projector: () =>
        pickRef.current.projector(wrapper.current?.clientWidth || 1, wrapper.current?.clientHeight || 1),
      aids: () => aids.getSnapshot(),
      bounds: () => boundsRef.current,
      plane: () => workPlane(viewModeRef.current),
      workPoint: (at, through) => {
        const plane = workPlane(viewModeRef.current);
        if (plane === "xy") return null;
        // Through the anchor, else through the point the camera looks at.
        const [tx, ty] = through ?? [nav.current.target[0] / MM, nav.current.target[1] / MM];
        return pickRef.current.workPoint(at[0], at[1], plane, plane === "xz" ? ty : tx);
      },
      handToViewer: (p) => handPointer(wrapper.current, p).at,
      handAspect: () => handAspect.current,
      navigate: (event: GestureEvent, dragMode = "orbit") => {
        navInput.current.dragMode = dragMode;
        nav.current = navigate(nav.current, navInput.current, event);
        if (navInput.current.momentum) invalidateRef.current(); // a flick: start coasting
        if (movesCamera(event)) {
          invalidateRef.current();
          pendingTs.current = Math.max(pendingTs.current ?? 0, event.ts);
        }
        const dragStart = event.type === "pinch.drag.start" || event.type === "fist.drag.start";
        const dragEnd = event.type === "pinch.drag.end" || event.type === "fist.drag.end";
        if (dragStart || event.type === "twohand.start") navigating.current = true;
        if (dragEnd || event.type === "twohand.end" || event.type === "disengaged")
          navigating.current = false;
        // A drag that pans shows the pan pointer for as long as it moves the view.
        if ("hand" in event && event.hand !== "both") {
          if (dragStart) shapeOf(event.hand, { panning: dragMode === "pan" });
          if (dragEnd) shapeOf(event.hand, { panning: false });
        } else if (event.type === "disengaged") {
          setHandShape({});
        }
      },
      press: (at, source) => {
        const target = features.on("handPress") ? controlFor(at, source) : null;
        // A press over a generated panel's frame cannot be a click: the frame is sandboxed, so its runtime is told
        // where the pointer let go and acts on the control beneath it.
        const place = target && target === panels.frame?.element ? inFrame(at) : null;
        if (place) {
          const source_ = source ?? "mouse";
          if (!framePresses.current.delete(source_)) panels.frame?.press("down", place[0], place[1]);
          panels.frame?.press("up", place[0], place[1]);
        } else target?.click();
        return target !== null;
      },
      pressStart: (at, source) => {
        const target = features.on("handPress") ? controlFor(at, source) : null;
        const place = target && target === panels.frame?.element ? inFrame(at) : null;
        if (!place) return;
        framePresses.current.add(source);
        panels.frame?.press("down", place[0], place[1]);
      },
      pressMove: (at, source) => {
        const place = framePresses.current.has(source) ? inFrame(at) : null;
        if (place) panels.frame?.press("move", place[0], place[1]);
      },
      pressCancel: (source) => {
        framePresses.current.delete(source);
      },
      isButton: (at, source) => features.on("handPress") && controlFor(at, source) !== null,
      scrollAt: (at) => {
        const area = features.on("handScrolling") ? scrollableAt(wrapper.current, at) : null;
        return area ? grabScroll(area, () => wrapper.current?.clientHeight ?? 1) : null;
      },
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
  }, [
    tools,
    client,
    visibility,
    sectionOutlineOnScreen,
    features,
    aids,
    controlFor,
    shapeOf,
    panels,
    inFrame,
    mirror,
  ]);

  // When a whole Rhino document has arrived, frame it once (as a project is framed when it opens).
  const syncedSeen = useRef(rhinoSynced);
  useEffect(() => {
    if (rhinoSynced === syncedSeen.current) return;
    syncedSeen.current = rhinoSynced;
    const box = mirror.bounds();
    if (!box) return;
    nav.current = frameBox(
      [box.min[0] * MM, box.min[1] * MM, box.min[2] * MM],
      [box.max[0] * MM, box.max[1] * MM, box.max[2] * MM],
    );
    invalidateRef.current();
  }, [rhinoSynced, mirror]);

  // The agent asks for a view: the camera animates there, and gives way at once to the user's own navigation.
  useEffect(
    () =>
      view.onViewRequest((request) => {
        // A named view switches at once (the cube's faces do the same); framing and distance then animate from it.
        if (request.view) showView(request.view);
        const doc = client.getSnapshot().doc;
        const boxOf = (ids: string[]) => {
          const boxes = ids.flatMap((id) => {
            const mirrored = mirror.getSnapshot().objects.find((o) => o.id === id);
            if (mirrored) return [mirrored.bounds];
            const element = doc?.elements[id];
            return element && doc ? [elementBounds(element, doc.levels)] : [];
          });
          if (boxes.length === 0) return null;
          return {
            min: [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k] as number))) as Point3Mm,
            max: [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k] as number))) as Point3Mm,
          };
        };
        const from = nav.current;
        const to = resolveView(from, request, boxOf);
        const started = performance.now();
        let last: Turntable = from;
        const step = () => {
          if (nav.current !== last) return; // the user took the camera: their navigation continues from here
          const t = Math.min(1, (performance.now() - started) / VIEW_ANIMATION_MS);
          last = t >= 1 ? to : between(from, to, t);
          nav.current = last;
          invalidateRef.current();
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    [view, client, mirror, showView],
  );

  // Hand input: the router sends each gesture to the palette, the active tool or navigation (never the bridge).
  // Both hands are pointers: each shows what a pinch would do there and lights the control it would press. The
  // focus hand (the one that pinched last, else the right) also drives hover in the model and a spoken "this".
  useEffect(() => {
    const router = new InputRouter(tools.routerTargets, gestures);
    let focus: Hand = "Right";
    const offGestures = bus.onGestures((events) => {
      for (const event of events) {
        if (event.type.startsWith("pinch.") && "hand" in event && event.hand !== "both") focus = event.hand;
        if (event.type === "clutch.start" || event.type === "clutch.end")
          shapeOf(
            event.hand,
            event.type === "clutch.start" ? { fist: true } : { fist: false, panning: false },
          );
        router.handle(event);
      }
    });
    const hideTimers: Partial<Record<Hand, ReturnType<typeof setTimeout>>> = {};
    const hovered: Partial<Record<Hand, HTMLElement | null>> = {};
    // A control under a pointer is marked with the hand(s) over it ("left", "right" or "both"), for its outline.
    const outline = (el: HTMLElement | null) => {
      if (!el) return;
      const over = (["Left", "Right"] as const).filter((h) => hovered[h] === el);
      if (over.length === 0) el.removeAttribute("data-hand-hover");
      else el.setAttribute("data-hand-hover", over.length === 2 ? "both" : (over[0] as Hand).toLowerCase());
    };
    const markHover = (hand: Hand, target: HTMLElement | null) => {
      const before = hovered[hand] ?? null;
      if (before === target) return;
      hovered[hand] = target;
      outline(before);
      outline(target);
    };
    const shown: Partial<Record<Hand, HandPointerState>> = {};
    /** Each hand's pinch on its way to a long pinch: where it closed and when, or `moved` once it left that spot. */
    const charging: Partial<Record<Hand, { position: Point2; since: number; moved: boolean }>> = {};
    const holdProgress = (hand: Hand, position: Point2, closing: boolean): number | null => {
      const bound = actionFor(gestures.bindings?.() ?? DEFAULT_BINDINGS, "hold", hand) !== "none";
      if (!closing || !bound) {
        delete charging[hand];
        return null;
      }
      const now = performance.now();
      const charge = charging[hand] ?? { position, since: now, moved: false };
      charging[hand] = charge;
      const { holdMs, holdMaxMove } = DEFAULT_GESTURES.pinch;
      const dx = position[0] - charge.position[0];
      const dy = (position[1] - charge.position[1]) / handAspect.current;
      if (Math.hypot(dx, dy) >= holdMaxMove) charge.moved = true; // a drag now: this pinch is no long pinch
      const held = now - charge.since;
      return charge.moved || held < HOLD_SHOWN_AFTER_MS || held >= holdMs ? null : held / holdMs;
    };
    const snaps: Partial<Record<Hand, HandSnap<HTMLElement>>> = {};
    const snapTargetOf = snapTargets.current;
    const publish = () => setPointers({ ...shown });
    const offPointer = bus.onPointer((sample) => {
      if (sample.aspect) handAspect.current = sample.aspect;
      // Controls are measured once a frame, and only when a pointer could snap.
      let controls: Array<SnapControl<HTMLElement>> | null = null;
      const snapping = bus.engaged && features.on("snapToButtons") && features.on("handPress");
      for (const hand of ["Left", "Right"] as const) {
        const position = sample.hands[hand];
        if (!position) {
          // Tracking often drops a hand for a frame or two: keep its pointer a moment rather than blink.
          if (shown[hand] && !hideTimers[hand]) {
            hideTimers[hand] = setTimeout(() => {
              delete hideTimers[hand];
              delete shown[hand];
              delete snaps[hand];
              delete snapTargetOf[hand];
              markHover(hand, null);
              publish();
            }, POINTER_HOLD_MS);
          }
          continue;
        }
        clearTimeout(hideTimers[hand]);
        delete hideTimers[hand];
        const { at, client } = handPointer(wrapper.current, position);
        // A pointer near a control snaps to it and is drawn on it; a pinch that began there keeps it.
        let drawn = client;
        let snapped: SnapControl<HTMLElement> | null = null;
        if (snapping) {
          controls ??= snapControls();
          const next = stepHandSnap(snaps[hand] ?? NO_SNAP, {
            point: client,
            now: performance.now(),
            controls,
            enabled: true,
            closing: sample.closing?.[hand] ?? false,
            ringOpen: tools.paletteOpen,
            usable: exposed,
          });
          snaps[hand] = next;
          snapped = next.target;
        } else {
          delete snaps[hand];
        }
        if (snapped) {
          snapTargetOf[hand] = snapped.key;
          drawn = snappedPoint(client, snapped.rect);
        } else {
          delete snapTargetOf[hand];
        }
        // The pointer always shows where the hand is; controls respond only while engaged.
        const target = snapped?.key ?? (bus.engaged ? pressableAt(wrapper.current, at) : null);
        markHover(hand, target);
        const hold = holdProgress(
          hand,
          position,
          bus.engaged && target === null && (sample.closing?.[hand] ?? false),
        );
        shown[hand] = { at, client: drawn, overControl: target !== null, focus: false, hold };
      }
      let focusHand: Hand | null = null;
      if (shown[focus]) focusHand = focus;
      else if (shown.Right) focusHand = "Right";
      else if (shown.Left) focusHand = "Left";
      for (const hand of ["Left", "Right"] as const) {
        const state = shown[hand];
        if (state) shown[hand] = { ...state, focus: hand === focusHand };
      }
      publish();
      const pointer = focusHand ? shown[focusHand] : undefined;
      groundAtRef.current = pointer?.at ?? null;
      if (
        !pointer ||
        !bus.engaged ||
        navigating.current ||
        pointer.overControl ||
        overHud(wrapper.current, pointer.at)
      ) {
        setHoverId(null);
        return;
      }
      const lit = features.on("snapToModels")
        ? pickRef.current.near(pointer.at[0], pointer.at[1])
        : pickRef.current.hit(pointer.at[0], pointer.at[1]);
      setHoverId(lit?.elementId ?? null);
      tools.hover(pointer.at, focusHand ?? "Right");
    });
    const offEngaged = bus.onEngaged((value) => {
      setEngaged(value);
      if (!value) {
        setHoverId(null);
        markHover("Left", null);
        markHover("Right", null);
      }
    });
    const offStopArmed = bus.onStopArmed(setStopArmed);
    return () => {
      offGestures();
      offPointer();
      offEngaged();
      offStopArmed();
      for (const timer of Object.values(hideTimers)) clearTimeout(timer);
    };
  }, [bus, tools, gestures, features, shapeOf]);

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
      const ring: Ring = e.shiftKey ? "reference" : "action";
      if (e.button === 2 && ringAllowed(features)) {
        drag.holdTimer = setTimeout(() => {
          if (!drag || drag.moved) return;
          tools.openPalette({ center: at, aspect: el.clientWidth / el.clientHeight }, "pointer", ring);
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
  }, [tools, features]);

  // Keyboard (not while typing): Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo; hold Space for the tools ring at the
  // pointer, Shift+Space for the create ring; one key per tool; Enter and Escape answer a confirmation (Escape also closes the palette).
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
        const ring: Ring = e.shiftKey ? "reference" : "action";
        if (!e.repeat && !tools.paletteOpen && canvas && ringAllowed(features)) {
          const aspect = canvas.clientWidth / canvas.clientHeight;
          tools.openPalette({ center: lastMouse.current ?? [0.5, 0.5], aspect }, "pointer", ring);
        }
        return;
      }
      // Enter answers a question, or finishes what the tool is drawing (a line).
      if (e.key === "Enter" && tools.accept()) {
        e.preventDefault();
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
  }, [client, tools, view, features]);

  // Latency readout refreshes twice a second.
  useEffect(() => {
    const id = setInterval(() => setP90(latency.p90()), 500);
    return () => clearInterval(id);
  }, [latency]);

  // Dev hooks for end-to-end tests.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__HAI_VIEWER__ = {
      camera: () => nav.current,
      meshCount: () => Object.keys(client.getSnapshot().doc?.elements ?? {}).length,
      // What a user can actually hit there: nothing under a HUD panel, as for the mouse and the hand.
      pick: (x, y) => (overHud(wrapper.current, [x, y]) ? null : pickRef.current.id(x, y)),
      latencyP90: () => latency.p90(),
      hovered: () => hoverIdRef.current,
      wear: (id) => wornBy(id),
      claimBoxes: () => ownersRef.current.boxes.map((b) => b.key),
      cameraMarkers: () => markersRef.current.map((m) => m.key),
      context: () => {
        const { context: held, showContext: shown } = contextRef.current;
        const count = (kind: string) => held.items.filter((i) => i.kind === kind).length;
        return {
          buildings: count("building"),
          trees: count("tree"),
          rasters: count("raster"),
          visible: shown,
          stale: held.stale,
        };
      },
      renders: () => rendersRef.current(),
      project: (point) => pickRef.current.project(point),
      sectionOutline: () => sectionOutlineOnScreen(),
      sun: () => view.sun,
      handAt: (x, y) => viewerToHand(wrapper.current, [x, y]),
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
    window.__HAI_TOOLS__ = tools;
    window.__HAI_INPUT__ = {
      gestures: (events) => bus.emitGestures(events),
      pointer: (right, left = null, closing) =>
        bus.emitPointer({
          hands: { ...(right ? { Right: right } : {}), ...(left ? { Left: left } : {}) },
          ...(closing ? { closing } : {}),
          ts: performance.timeOrigin + performance.now(),
        }),
      engaged: (engaged) => bus.setEngaged(engaged),
    };
  }, [bus, client, latency, tools, sectionOutlineOnScreen, view]);

  // The hand pointer shows what a pinch would do here: press a button, steer the palette, grab the section, or the
  // active tool's own action (its icon).
  const activeIcon = tools.registry.get(toolState.activeId)?.icon ?? null;
  const fistPans = (hand: Hand) =>
    actionFor(gestures.bindings?.() ?? DEFAULT_BINDINGS, "fistdrag", hand) === "pan";
  const pointerLook = (hand: Hand, p: HandPointerState): { mode: string; glyph: string | null } => {
    let mode: string = toolState.activeId;
    if (!engaged) mode = "idle";
    else if (toolState.palette?.hand === hand && !toolState.palette.hidden) mode = "palette";
    else if (listeningHand === hand) mode = "talk";
    else if (handShape[hand]?.panning || (handShape[hand]?.fist && fistPans(hand))) mode = "pan";
    else if (p.overControl) mode = "press";
    else if (p.focus && toolState.overlay.sectionHover) mode = "grab";
    if (mode === "grab") return { mode, glyph: "M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" };
    if (mode === "pan") return { mode, glyph: PAN_ICON };
    if (mode === "talk") return { mode, glyph: MIC_ICON };
    return {
      mode,
      glyph: mode === toolState.activeId && toolState.activeId !== "select" ? activeIcon : null,
    };
  };

  const selection = new Set(scene.selection);
  const { overlay } = toolState;
  const references = useSyncExternalStore(tools.references.subscribe, tools.references.getSnapshot);
  const voiceState = useSyncExternalStore(
    voice?.subscribe ?? NO_VOICE.subscribe,
    voice?.getSnapshot ?? NO_VOICE.getSnapshot,
  );
  const heldPoints = useSyncExternalStore(
    voice?.context.subscribe ?? NO_VOICE.subscribe,
    () => voice?.context.points ?? NO_POINTS,
  );
  // The hand whose long pinch is listening now, and the hand a held request's chip belongs to.
  const listeningHand =
    (voiceState.phase === "starting" || voiceState.phase === "listening") && voiceState.held
      ? voiceState.held
      : null;
  const chipHand = "held" in voiceState && voiceState.held ? voiceState.held : null;
  // A microphone that failed is said beside the hand only while it still holds (the agent panel keeps the fix).
  const chipText =
    voiceState.phase === "error" && !toolState.held ? null : heldChipText(voiceState, listeningHand !== null);
  // A move preview applies only while the element is still as it was when the drag began.
  const previewOffset = (element: Element): [number, number] | null =>
    overlay.movePreview?.id === element.id && overlay.movePreview.from === JSON.stringify(element)
      ? overlay.movePreview.offsetMm
      : null;
  const selected = scene.doc && scene.selection[0] ? scene.doc.elements[scene.selection[0]] : undefined;
  const submitProject = (e: FormEvent) => {
    e.preventDefault();
    const path = projectPath.trim();
    if (path) {
      if (projectForm === "new") client.createProject(path);
      else client.openProject(path);
    }
    setProjectForm(null);
  };

  return (
    <section
      className="viewer"
      ref={wrapper}
      aria-label="3D model"
      data-testid="viewer"
      data-tool={toolState.activeId}
      data-view={viewMode}
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
        // PCF shadows: three 0.186 dropped the soft variant that `shadows` alone asks for.
        shadows={software ? false : "percentage"}
        camera={{ fov: FOV, near: 0.1, far: 5000, position: [60, -40, 40] }}
        gl={{ antialias: !software, preserveDrawingBuffer: true }}
        dpr={software ? 1 : [1, 2]}
        data-renderer={software ? "software" : "gpu"}
      >
        <color attach="background" args={[colors.background]} />
        <hemisphereLight args={["#ffffff", "#b9b4a8", 1.1]} />
        <SunLight view={view} extent={contextExtent(context.items)} />
        <Grid
          userData={{ grid: true }}
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
        <ContextLayer
          state={context}
          colors={{ element: colors.element, background: colors.background }}
          visible={showContext}
        />
        <OwnerDisplayContext.Provider value={owners ?? NO_OWNERS}>
          <MirrorLayer
            mirror={mirror}
            assets={mirrorAssets}
            colors={{ element: colors.element, hover: colors.hover, selected: colors.selected }}
            hoverId={hoverId}
          />
          <ModelAssetsContext.Provider value={modelAssets}>
            {shownDoc &&
              Object.values(shownDoc.elements)
                .filter((element) => !hidden.has(element.id))
                .map((element) => (
                  <ElementMesh
                    key={element.id}
                    element={element}
                    doc={shownDoc as SceneDocument}
                    colors={colors}
                    selected={selection.has(element.id)}
                    hovered={hoverId === element.id}
                    marked={overlay.marked === element.id}
                    offsetMm={previewOffset(element)}
                    sectionMm={overlay.sectionMm}
                  />
                ))}
          </ModelAssetsContext.Provider>
          <group userData={USER_ONLY}>
            <ClaimBoxes boxes={(owners ?? NO_OWNERS).boxes} />
          </group>
        </OwnerDisplayContext.Provider>
        {shownDoc && overlay.draft && (
          <group userData={USER_ONLY}>
            <ElementMesh
              key="draft"
              element={overlay.draft}
              doc={shownDoc}
              colors={colors}
              selected={false}
              hovered={false}
              marked={false}
              offsetMm={null}
              sectionMm={overlay.sectionMm}
              draft
            />
          </group>
        )}
        <SectionClipping heightMm={overlay.sectionMm} version={clipVersion} />
        <group userData={USER_ONLY}>
          {overlay.sectionMm !== null && (
            <SectionPlane
              heightMm={overlay.sectionMm}
              bounds={boundsMm}
              color={colors.selected}
              hovered={overlay.sectionHover}
            />
          )}
          {overlay.measure.length > 0 && <MeasureMarks points={overlay.measure} color={colors.selected} />}
          {overlay.snap && <SnapMarker point={overlay.snap.point} label={overlay.snap.label} />}
          {markers.length > 0 && <ReferenceMarkers ids={markers} doc={shownDoc} />}
          {toolState.held && (
            <HeldTargetMark
              target={toolState.held.target}
              doc={shownDoc}
              color={toolState.held.hand === "Left" ? colors.handLeft : colors.handRight}
            />
          )}
          {heldPoints.length > 0 && <HeldPoints points={heldPoints} />}
          <ReferenceMarks
            references={references}
            colors={{ Left: colors.handLeft, Right: colors.handRight, mouse: colors.selected }}
          />
        </group>
        {cameraMarkers.length > 0 && <CameraMarkers markers={cameraMarkers} />}
        <OrthographicCamera makeDefault={viewMode !== "perspective"} near={0.1} far={5000} />
        <CameraRig
          modeRef={viewModeRef}
          onLeaveView={leaveView}
          cubeRef={cubeRef}
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

      {/* Both hands' pointers, drawn over the whole page: they reach the sidebar too. */}
      {createPortal(
        (["Left", "Right"] as const).map((hand) => {
          const p = pointers[hand];
          if (!p) return null;
          const { mode, glyph } = pointerLook(hand, p);
          return (
            <div
              key={hand}
              className="hand-pointer"
              data-testid={`hand-pointer-${hand.toLowerCase()}`}
              data-hand={hand.toLowerCase()}
              data-mode={mode}
              data-engaged={engaged}
              data-focus={p.focus}
              data-panning={handShape[hand]?.panning ?? false}
              style={{ left: `${p.client[0]}px`, top: `${p.client[1]}px` }}
              aria-hidden="true"
            >
              {glyph && <ToolIcon path={glyph} size={mode === "pan" ? 20 : 14} />}
              {p.hold !== null && (
                <svg
                  aria-hidden="true"
                  className="hold-progress"
                  viewBox="0 0 48 48"
                  data-testid={`hold-progress-${hand.toLowerCase()}`}
                >
                  <circle cx="24" cy="24" r="21" pathLength="100" strokeDasharray={`${p.hold * 100} 100`} />
                </svg>
              )}
            </div>
          );
        }),
        document.body,
      )}
      {chipHand &&
        chipText &&
        pointers[chipHand] &&
        createPortal(
          <div
            className="held-chip"
            data-testid="held-chip"
            data-hand={chipHand.toLowerCase()}
            data-phase={voiceState.phase}
            data-ring={toolState.palette?.hand === chipHand && !toolState.palette.hidden}
            role="status"
            style={{ left: `${pointers[chipHand]?.client[0]}px`, top: `${pointers[chipHand]?.client[1]}px` }}
          >
            {voiceState.phase === "listening" && <span className="held-chip-dot" aria-hidden="true" />}
            {chipText}
          </div>,
          document.body,
        )}
      {stopArmed && (
        <p className="stop-armed" data-testid="stop-armed" role="status">
          Open both hands to stop
        </p>
      )}

      <ToolOverlays controller={tools} />
      {/* The viewport's right column: the drawing constraints while Line or Wall is active. */}
      <div className="viewer-right">
        <ViewCube mode={viewMode} onView={showView} cubeRef={cubeRef} initial={nav.current} />
        <ConstraintsPanel controller={tools} aids={aids} />
      </div>
      <UndoStrip client={client} />
      <GeneratedPanel client={panels} scene={client} />

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
            <button
              type="button"
              className="secondary"
              data-testid="open-project"
              onClick={() => setProjectForm((f) => (f === "open" ? null : "open"))}
            >
              Open project
            </button>
            <button
              type="button"
              className="secondary"
              data-testid="new-project"
              title="Start a project with a clean space to import or draw in"
              onClick={() => setProjectForm((f) => (f === "new" ? null : "new"))}
            >
              New project
            </button>
            <ImportButton importer={importer} />
            <SaveAs3dmButton exporter={exporter} />
          </div>
          {projectForm && (
            <form className="open-project" onSubmit={submitProject} data-testid="project-form">
              <input
                type="text"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="D:\Projects\My building"
                aria-label={projectForm === "new" ? "Folder for the new project" : "Project folder path"}
                data-testid="project-path"
              />
              <button type="submit" className="primary" data-testid="project-submit">
                {projectForm === "new" ? "Create" : "Open"}
              </button>
            </form>
          )}
          {scene.projectMessage && (
            <p className="project-message" role="alert" data-testid="project-message">
              {scene.projectMessage}
              <button
                type="button"
                className="secondary"
                data-hand-press
                onClick={() => client.clearProjectMessage()}
              >
                Close
              </button>
            </p>
          )}
        </div>
        <ImportReport importer={importer} />
        <ExportReport exporter={exporter} />
        {children}
      </div>
      <ImportDropZone importer={importer} />

      <div className="viewer-status" data-hud>
        <ActiveTool controller={tools} />
        <span data-testid="selection-status">
          {selected ? `${selected.name} (${selected.type})` : "Nothing selected"}
        </span>
        <span data-testid="aids-status">
          Aids:{" "}
          {DRAWING_AIDS.filter((a) => aidState[a.id])
            .map((a) => a.label)
            .join(", ") || "none"}
        </span>
        {featureState.latencyReadout && (
          <span data-testid="hud-latency">
            {p90 === null ? "Gesture to render: -" : `Gesture to render p90: ${Math.round(p90)} ms`}
          </span>
        )}
      </div>
    </section>
  );
}
