import {
  type AgentCamera,
  MAX_AGENT_CAMERAS,
  type SceneDocument,
  type SunSetting,
  type TeamCamera,
  type TeamShot,
  type ViewRequest,
} from "@hai/protocol";
import { type BoundsMm, elementBounds, frameBox, resolveView, type Turntable } from "@hai/scene";
import type { ShotsResult } from "./view-context.ts";

const MM = 0.001;
/** The longest side of a picture when the agent does not say, and of each picture in a set of several. */
export const SHOT_SIZE = 1024;
export const SHEET_SIZE = 640;

export const PRESETS = ["iso", "top", "front", "left", "orbit-sheet"] as const;
export type Preset = (typeof PRESETS)[number];

/** The compass side a camera looks from (azimuth runs from +X toward +Y, and north is +Y). */
const COMPASS = ["e", "ne", "n", "nw", "w", "sw", "s", "se"] as const;
const compass = (azimuth: number) => COMPASS[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8] as string;

const toTurntable = (c: AgentCamera): Turntable => ({
  target: [c.target[0] * MM, c.target[1] * MM, c.target[2] * MM],
  azimuth: c.azimuth,
  elevation: c.elevation,
  distance: c.distance * MM,
});
const fromTurntable = (name: string, t: Turntable): AgentCamera => ({
  name,
  azimuth: Math.round(t.azimuth * 10) / 10,
  elevation: Math.round(t.elevation * 10) / 10,
  distance: Math.round(t.distance / MM),
  target: [Math.round(t.target[0] / MM), Math.round(t.target[1] / MM), Math.round(t.target[2] / MM)],
});

/** The view that frames a box (millimetres) from the default angle. */
function framing(box: BoundsMm | null): Turntable {
  if (!box) return { target: [0, 0, 0], azimuth: 305, elevation: 32, distance: 30 };
  return frameBox(
    [box.min[0] * MM, box.min[1] * MM, box.min[2] * MM],
    [box.max[0] * MM, box.max[1] * MM, box.max[2] * MM],
  );
}

/** The cameras of a preset, framed on a box (the whole model, or the elements the agent named). */
export function presetCameras(preset: Preset, box: BoundsMm | null): AgentCamera[] {
  const base = framing(box);
  const at = (name: string, azimuth: number, elevation: number) =>
    fromTurntable(name, { ...base, azimuth, elevation });
  switch (preset) {
    case "iso":
      return [45, 135, 225, 315].map((az) => at(`iso-${compass(az)}`, az, 35));
    case "top":
      return [at("top", 270, 89)];
    case "front":
      return [at("front", 270, 10)];
    case "left":
      return [at("left", 180, 10)];
    case "orbit-sheet":
      return [0, 45, 90, 135, 180, 225, 270, 315].map((az) => at(`orbit-${compass(az)}`, az, 30));
  }
}

/** The direction a camera looks from, for the label of its picture. */
export function describeCamera(camera: AgentCamera): string {
  return `${camera.name}: from the ${compass(camera.azimuth)}, ${Math.round(camera.elevation)} degrees up, ${Math.round(camera.distance / 100) / 10} m away`;
}

export interface EyesDeps {
  doc(): SceneDocument;
  /** The Rhino objects mirrored now, with their boxes in millimetres. */
  rhinoBounds(): Array<{ id: string; bounds: BoundsMm }>;
  /** Takes pictures off-screen from cameras in a viewer. */
  shoot(request: {
    agent: string;
    cameras: AgentCamera[];
    size: number;
    section: boolean;
    selection: boolean;
    sun?: SunSetting;
  }): Promise<ShotsResult>;
  /** Cameras or last pictures changed: the team strip should be told. */
  changed(): void;
}

export type PlaceResult = { ok: true; camera: AgentCamera } | { ok: false; error: string };

/**
 * The agents' own eyes: a few named cameras per agent, private to it, and the last picture each took. A camera is
 * only numbers here; pictures are made off-screen by a viewer, so the user's camera, canvas and selection are never
 * involved. An agent's cameras end with its task.
 */
export class AgentEyes {
  private readonly cameras = new Map<string, Map<string, AgentCamera>>();
  private readonly shots = new Map<string, TeamShot>();

  constructor(private readonly deps: EyesDeps) {}

  /** The box of the whole model, or of the named elements (scene elements and mirrored Rhino objects). */
  box(ids?: string[]): BoundsMm | null {
    const doc = this.deps.doc();
    const rhino = this.deps.rhinoBounds();
    const boxes: BoundsMm[] = [];
    if (ids) {
      for (const id of ids) {
        const mirrored = rhino.find((o) => o.id === id);
        const element = doc.elements[id];
        if (mirrored) boxes.push(mirrored.bounds);
        else if (element) boxes.push(elementBounds(element, doc.levels));
      }
    } else {
      for (const element of Object.values(doc.elements)) boxes.push(elementBounds(element, doc.levels));
      for (const o of rhino) boxes.push(o.bounds);
    }
    if (boxes.length === 0) return null;
    const along = (k: 0 | 1 | 2) => ({
      min: Math.min(...boxes.map((b) => b.min[k])),
      max: Math.max(...boxes.map((b) => b.max[k])),
    });
    const [x, y, z] = [along(0), along(1), along(2)];
    return { min: [x.min, y.min, z.min], max: [x.max, y.max, z.max] };
  }

  /**
   * Places or moves a camera. What the request leaves out stays as it was (or, for a new camera, as the model's
   * default framing). Nothing here touches the user's view.
   */
  place(agent: string, name: string, request: ViewRequest): PlaceResult {
    const own = this.cameras.get(agent) ?? new Map<string, AgentCamera>();
    const existing = own.get(name);
    if (!existing && own.size >= MAX_AGENT_CAMERAS) {
      return {
        ok: false,
        error: `You already have ${MAX_AGENT_CAMERAS} cameras (${[...own.keys()].join(", ")}). Delete one with camera_delete first.`,
      };
    }
    const base = existing ? toTurntable(existing) : framing(this.box());
    const missing = request.frame?.filter((id) => this.box([id]) === null) ?? [];
    if (missing.length > 0 && missing.length === request.frame?.length) {
      return {
        ok: false,
        error: `No element with the id ${missing.map((m) => `"${m}"`).join(", ")}, so there is nothing to frame.`,
      };
    }
    const resolved = resolveView(base, request, (ids) => this.box(ids));
    const camera = fromTurntable(name, resolved);
    own.set(name, camera);
    this.cameras.set(agent, own);
    this.deps.changed();
    return { ok: true, camera };
  }

  get(agent: string, name: string): AgentCamera | undefined {
    return this.cameras.get(agent)?.get(name);
  }

  list(agent: string): AgentCamera[] {
    return [...(this.cameras.get(agent)?.values() ?? [])];
  }

  remove(agent: string, name: string): boolean {
    const own = this.cameras.get(agent);
    const removed = own?.delete(name) ?? false;
    if (own?.size === 0) this.cameras.delete(agent);
    if (removed) this.deps.changed();
    return removed;
  }

  /**
   * An agent's task ended: its cameras go, and its last picture stays in the strip until it takes another or the
   * project changes. With no agent (the project changed), everything goes.
   */
  clear(agent?: string): void {
    const had = agent ? this.cameras.has(agent) : this.cameras.size + this.shots.size > 0;
    if (agent) {
      this.cameras.delete(agent);
    } else {
      this.cameras.clear();
      this.shots.clear();
    }
    if (had) this.deps.changed();
  }

  noteShot(agent: string, camera: string, thumb: string): void {
    this.shots.set(agent, { agent, camera, at: Date.now(), thumb });
    this.deps.changed();
  }

  snapshot(): { shots: TeamShot[]; cameras: TeamCamera[] } {
    return {
      shots: [...this.shots.values()],
      cameras: [...this.cameras].flatMap(([agent, own]) => [...own.values()].map((c) => ({ ...c, agent }))),
    };
  }

  /** Pictures from cameras (already placed, or made by a preset), in the order given. */
  async capture(
    agent: string,
    cameras: AgentCamera[],
    options: { size?: number; section?: boolean; selection?: boolean; sun?: SunSetting },
  ): Promise<
    { ok: true; shots: Array<{ camera: AgentCamera; png: string }> } | { ok: false; error: string }
  > {
    const size = options.size ?? (cameras.length > 1 ? SHEET_SIZE : SHOT_SIZE);
    const result = await this.deps.shoot({
      agent,
      cameras,
      size,
      section: options.section ?? false,
      selection: options.selection ?? false,
      ...(options.sun ? { sun: options.sun } : {}),
    });
    if (!result.ok) return result;
    const shots = result.shots;
    if (shots.length !== cameras.length) {
      return { ok: false, error: "The viewer did not return a picture for every camera." };
    }
    const last = shots.at(-1);
    if (last) this.noteShot(agent, last.camera, last.thumb);
    return {
      ok: true,
      shots: shots.map((s, i) => ({ camera: cameras[i] as AgentCamera, png: s.png })),
    };
  }
}
