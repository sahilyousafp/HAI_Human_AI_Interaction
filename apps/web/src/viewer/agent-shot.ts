import type { AgentCamera, SunSetting } from "@hai/protocol";
import { sunLightDirection } from "@hai/scene";
import * as THREE from "three";
import { captureSize } from "../agent/view-link.ts";
import { cameraPosition } from "./turntable.ts";

const MM = 0.001;
/** The longest side of the small picture the team strip shows. */
export const THUMB_SIDE = 240;
/** How far away (metres) the sun's light is placed: beyond the model, inside the shadow camera's reach. */
export const SUN_DISTANCE = 120;

/**
 * Marks something in the scene that is the user's own marking (a section plane, measuring marks, the snap marker, a
 * claim box, a camera marker, a tool's draft): an agent's picture leaves it out.
 */
export const USER_ONLY = { userOnly: true } as const;

export interface Shot {
  camera: string;
  png: string;
  thumb: string;
}

/** The full picture of each agent's last shot, kept here (not on the bridge) so the strip can enlarge it. */
const remembered = new Map<string, { camera: string; png: string }>();
export const rememberShot = (agent: string, shot: Shot) =>
  remembered.set(agent, { camera: shot.camera, png: shot.png });
export const rememberedShot = (agent: string) => remembered.get(agent);

export interface ShotRequest {
  cameras: AgentCamera[];
  /** The longest side of each picture in pixels; never larger than the viewer's own canvas. */
  size: number;
  /** Show the section cut the user has set. */
  section: boolean;
  /** Show the user's selection, hover and deletion marks. */
  selection: boolean;
  /** Take the pictures in this sun's light, for the pictures only. */
  sun?: SunSetting | undefined;
}

/** The part of the viewer a picture needs; the real one is the viewer's own renderer, scene and camera. */
export interface ShotRig {
  gl: Pick<THREE.WebGLRenderer, "render" | "domElement" | "localClippingEnabled">;
  scene: THREE.Scene;
  /** The user's camera: the frame it sees is put back at the end. */
  camera: THREE.Camera;
  fov: number;
  /** Copies what the canvas shows now into an image of this size. Replaceable for tests. */
  copy?(source: HTMLCanvasElement, width: number, height: number): ShotImage;
}

/** A copy of the canvas, scaled, that can be encoded after the viewer has drawn the user's frame again. */
export interface ShotImage {
  png(): Promise<string>;
  thumb(): Promise<string>;
}

const base64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/** The canvas encoded by the browser off the main thread, as a data URL. */
function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("The browser could not encode the picture."));
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("The browser could not read the picture."));
        reader.readAsDataURL(blob);
      },
      type,
      quality,
    );
  });
}

function copyCanvas(source: HTMLCanvasElement, width: number, height: number): ShotImage {
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const context = out.getContext("2d");
  if (!context) throw new Error("The browser could not prepare the image.");
  context.drawImage(source, 0, 0, width, height);
  return {
    png: async () => base64(await encode(out, "image/png")),
    thumb: () => {
      const [w, h] = captureSize(width, height, THUMB_SIDE);
      const small = document.createElement("canvas");
      small.width = w;
      small.height = h;
      small.getContext("2d")?.drawImage(out, 0, 0, w, h);
      return encode(small, "image/jpeg", 0.7);
    },
  };
}

/**
 * Pictures from an agent's cameras, one after another. Each is one synchronous step: the viewer's own renderer draws
 * it, then the user's frame is drawn again, so the browser never paints in between: the user's canvas, camera,
 * selection and light are the same before and after and nothing flashes. For the step, what is only the user's (hover,
 * selection and deletion colours, tool marks, the section cut unless asked, the user's light when a sun is given) is
 * put aside, and put back before the step ends, whatever happens. Between cameras the browser is free, so the user's
 * own frames keep coming while a set of eight is taken.
 */
export async function takeShots(rig: ShotRig, request: ShotRequest): Promise<Shot[]> {
  const shots: Shot[] = [];
  for (const spec of request.cameras) {
    const image = shootOne(rig, request, spec);
    shots.push({ camera: spec.name, png: await image.png(), thumb: await image.thumb() });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return shots;
}

function shootOne(rig: ShotRig, request: ShotRequest, spec: AgentCamera): ShotImage {
  const { gl, scene } = rig;
  const copy = rig.copy ?? copyCanvas;
  const undo: Array<() => void> = [];
  const afterRender = scene.onAfterRender;
  const clipping = gl.localClippingEnabled;
  let image: ShotImage | null = null;
  const grids: THREE.Mesh[] = [];
  try {
    // The latency stamps and picking helpers hook the scene's render: these renders are not the user's frames.
    scene.onAfterRender = () => {};
    scene.traverse((object) => {
      if (object.userData.userOnly === true && object.visible) {
        object.visible = false;
        undo.push(() => {
          object.visible = true;
        });
      }
      const mesh = object as THREE.Mesh;
      const clean = object.userData.cleanColor as string | undefined;
      if (!request.selection && clean && mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
        const material = mesh.material;
        const color = material.color.clone();
        const glow = material.emissiveIntensity;
        material.color.set(clean);
        material.emissiveIntensity = 0;
        undo.push(() => {
          material.color.copy(color);
          material.emissiveIntensity = glow;
        });
      }
      // The infinite grid is centred under the viewer's camera from frame to frame; each picture centres it under its own.
      if (object.userData.grid === true) {
        const uniform = (object as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material.uniforms
          .worldCamProjPosition?.value as THREE.Vector3 | undefined;
        if (uniform) {
          const was = uniform.clone();
          grids.push(object as THREE.Mesh);
          undo.push(() => uniform.copy(was));
        }
      }
      const light = object as THREE.DirectionalLight;
      if (request.sun && light.isDirectionalLight) {
        const { position, intensity } = { position: light.position.clone(), intensity: light.intensity };
        const [x, y, z] = sunLightDirection(request.sun);
        light.position.set(-x * SUN_DISTANCE, -y * SUN_DISTANCE, -z * SUN_DISTANCE);
        light.intensity = request.sun.altitude > 0 ? 1.8 : 0;
        light.updateMatrixWorld();
        undo.push(() => {
          light.position.copy(position);
          light.intensity = intensity;
          light.updateMatrixWorld();
        });
      }
    });
    if (!request.section) gl.localClippingEnabled = false;

    const canvas = gl.domElement;
    const [width, height] = captureSize(canvas.width, canvas.height, request.size);
    const aspect = canvas.width / Math.max(1, canvas.height);
    {
      const camera = new THREE.PerspectiveCamera(rig.fov, aspect, 0.1, 5000);
      camera.up.set(0, 0, 1);
      camera.position.set(
        ...cameraPosition({
          target: [spec.target[0] * MM, spec.target[1] * MM, spec.target[2] * MM],
          azimuth: spec.azimuth,
          elevation: spec.elevation,
          distance: spec.distance * MM,
        }),
      );
      camera.lookAt(spec.target[0] * MM, spec.target[1] * MM, spec.target[2] * MM);
      camera.updateMatrixWorld();
      for (const grid of grids) {
        grid.updateMatrixWorld();
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(),
        );
        plane.applyMatrix4(grid.matrixWorld);
        const uniform = (grid.material as THREE.ShaderMaterial).uniforms.worldCamProjPosition
          ?.value as THREE.Vector3;
        plane.projectPoint(camera.position, uniform);
      }
      gl.render(scene, camera);
      image = copy(canvas, width, height);
    }
  } finally {
    for (const restore of undo.reverse()) restore();
    gl.localClippingEnabled = clipping;
    // The user's frame, as it was: drawn again before the browser can paint the last picture.
    gl.render(scene, rig.camera);
    scene.onAfterRender = afterRender;
  }
  if (!image) throw new Error("The viewer could not take the picture.");
  return image;
}
