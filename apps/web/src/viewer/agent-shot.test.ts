import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { type ShotRig, takeShots, USER_ONLY } from "./agent-shot.ts";

const camera = {
  name: "south",
  azimuth: 270,
  elevation: 30,
  distance: 20000,
  target: [0, 0, 0] as [number, number, number],
};

/** What the scene looked like when a render was asked for. */
interface Seen {
  camera: THREE.Camera;
  markVisible: boolean;
  color: string;
  glow: number;
  clipping: boolean;
  sun: number;
  afterRender: boolean;
  grid: number[];
}

function setup() {
  const scene = new THREE.Scene();
  const mark = new THREE.Group();
  mark.userData = { ...USER_ONLY };
  scene.add(mark);
  // A selected element: drawn in the selection colour, with a glow, and its clean colour in userData.
  const material = new THREE.MeshStandardMaterial({
    color: "#2f6fe4",
    emissive: "#ffcc00",
    emissiveIntensity: 0.6,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  mesh.userData = { elementId: "wall-1", cleanColor: "#cccccc" };
  scene.add(mesh);
  // The infinite grid: centred under whichever camera is drawing, through a uniform the viewer sets each frame.
  const gridMaterial = new THREE.ShaderMaterial({
    uniforms: { worldCamProjPosition: { value: new THREE.Vector3(7, 8, -0.31) } },
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(), gridMaterial);
  grid.userData = { grid: true };
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.31;
  scene.add(grid);
  const light = new THREE.DirectionalLight("#ffffff", 1.6);
  light.position.set(-40, -60, 90);
  scene.add(light);
  const hook = () => {};
  scene.onAfterRender = hook;
  const canvas = { width: 1600, height: 900 } as HTMLCanvasElement;
  const seen: Seen[] = [];
  const gl = {
    domElement: canvas,
    localClippingEnabled: true,
    render: (_scene: THREE.Scene, cam: THREE.Camera) => {
      seen.push({
        camera: cam,
        markVisible: mark.visible,
        color: `#${material.color.getHexString()}`,
        glow: material.emissiveIntensity,
        clipping: gl.localClippingEnabled,
        sun: light.intensity,
        afterRender: scene.onAfterRender === hook,
        grid: gridMaterial.uniforms.worldCamProjPosition?.value.toArray() as number[],
      });
    },
  };
  const userCamera = new THREE.PerspectiveCamera();
  const copies: Array<[number, number]> = [];
  const rig: ShotRig = {
    gl: gl as unknown as ShotRig["gl"],
    scene,
    camera: userCamera,
    fov: 45,
    copy: (_source, width, height) => {
      copies.push([width, height]);
      return { png: async () => `png-${width}x${height}`, thumb: async () => "thumb" };
    },
  };
  return { rig, seen, copies, gridMaterial, mark, material, light, hook, scene, userCamera, gl };
}

const request = { cameras: [camera], size: 1280, section: false, selection: false };

describe("pictures from an agent's camera", () => {
  it("leave out the user's marks, selection colour and section while drawing, and put the user's frame back", async () => {
    const { rig, seen, material, mark, light, hook, scene, userCamera, gl } = setup();
    const shots = await takeShots(rig, request);

    expect(shots).toEqual([{ camera: "south", png: "png-1280x720", thumb: "thumb" }]);
    // Two renders: the agent's camera with the user's state put aside, then the user's own camera.
    expect(seen).toHaveLength(2);
    const [shot, again] = seen as [Seen, Seen];
    expect(shot.camera).not.toBe(userCamera);
    expect(shot).toMatchObject({
      markVisible: false,
      color: "#cccccc",
      glow: 0,
      clipping: false,
      afterRender: false,
    });
    expect(again.camera).toBe(userCamera);
    // Everything is back as the user had it.
    expect(again).toMatchObject({
      markVisible: true,
      color: "#2f6fe4",
      glow: 0.6,
      clipping: true,
      afterRender: false,
    });
    expect(mark.visible).toBe(true);
    expect(`#${material.color.getHexString()}`).toBe("#2f6fe4");
    expect(material.emissiveIntensity).toBe(0.6);
    expect(light.intensity).toBe(1.6);
    expect(gl.localClippingEnabled).toBe(true);
    expect(scene.onAfterRender).toBe(hook);
  });

  it("look from the camera the agent placed", async () => {
    const { rig, seen } = setup();
    await takeShots(rig, request);
    const position = (seen[0] as Seen).camera.position;
    // 20 m away, 30 degrees up, from the south (azimuth 270): below the target on Y, above it on Z.
    expect(position.x).toBeCloseTo(0, 3);
    expect(position.y).toBeCloseTo(-20 * Math.cos(Math.PI / 6), 3);
    expect(position.z).toBeCloseTo(20 * Math.sin(Math.PI / 6), 3);
  });

  it("centre the grid under the picture's camera, and under the user's again afterwards", async () => {
    const { rig, seen } = setup();
    await takeShots(rig, request);
    // The camera is 20 m south at 30 degrees: its point on the ground plane is 17.3 m south of the target.
    expect(seen[0]?.grid[0]).toBeCloseTo(0, 3);
    expect(seen[0]?.grid[1]).toBeCloseTo(-20 * Math.cos(Math.PI / 6), 3);
    expect(seen[1]?.grid).toEqual([7, 8, -0.31]);
  });

  it("show the section cut and the selection only when asked", async () => {
    const { rig, seen } = setup();
    await takeShots(rig, { ...request, section: true, selection: true });
    expect(seen[0]).toMatchObject({ clipping: true, color: "#2f6fe4", glow: 0.6, markVisible: false });
  });

  it("take every camera in one step, sized to the canvas and the request, never enlarged", async () => {
    const { rig, seen, copies } = setup();
    const cameras = [
      camera,
      { ...camera, name: "east", azimuth: 0 },
      { ...camera, name: "top", elevation: 89 },
    ];
    const shots = await takeShots(rig, { ...request, cameras, size: 640 });
    expect(shots.map((s) => s.camera)).toEqual(["south", "east", "top"]);
    expect(copies).toEqual([
      [640, 360],
      [640, 360],
      [640, 360],
    ]);
    expect(seen).toHaveLength(6);
    expect((await takeShots(rig, { ...request, size: 5000 })).length).toBe(1);
    expect(copies.at(-1)).toEqual([1600, 900]);
  });

  it("leave the browser free between cameras, so the user's own frames keep coming", async () => {
    const { rig, seen } = setup();
    let renders = -1;
    setTimeout(() => {
      renders = seen.length;
    }, 0);
    const cameras = [camera, { ...camera, name: "east" }, { ...camera, name: "top" }];
    await takeShots(rig, { ...request, cameras });
    // A timer set before the pictures ran after the first camera and before the last (two renders each).
    expect(renders).toBeGreaterThan(0);
    expect(renders).toBeLessThan(6);
  });

  it("light the pictures with the sun they are given, and the user's light is back afterwards", async () => {
    const { rig, seen, light } = setup();
    await takeShots(rig, { ...request, sun: { altitude: 15, azimuth: 180, label: "winter" } });
    expect(seen[0]?.sun).toBe(1.8);
    expect(seen[1]?.sun).toBe(1.6);
    expect(light.position.toArray()).toEqual([-40, -60, 90]);
  });

  it("put everything back even when drawing fails", async () => {
    const { rig, material, mark, gl, hook, scene } = setup();
    let calls = 0;
    const real = gl.render;
    gl.render = (s: THREE.Scene, c: THREE.Camera) => {
      calls++;
      if (calls === 1) throw new Error("context lost");
      real(s, c);
    };
    await expect(takeShots(rig, request)).rejects.toThrow("context lost");
    expect(mark.visible).toBe(true);
    expect(`#${material.color.getHexString()}`).toBe("#2f6fe4");
    expect(gl.localClippingEnabled).toBe(true);
    expect(scene.onAfterRender).toBe(hook);
    expect(calls).toBe(2);
  });
});
