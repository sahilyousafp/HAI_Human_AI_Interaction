import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseScene, type SceneDocument } from "@hai/protocol";
import { migrateLegacyProject } from "./legacy.ts";
import { readSettingsFile, updateSettingsFile } from "./settings.ts";

export const SCENE_FILE = "scene.hai.json";
export const SAMPLE_SCENE = join(import.meta.dirname, "..", "samples", "mixed-use-block.hai.json");

export interface ProjectInfo {
  name: string;
  path: string;
}

/** Opens a project folder: reads its scene file, or seeds it from the sample scene if the folder has none. */
export function openProject(
  dir: string,
): { ok: true; project: ProjectInfo; doc: SceneDocument } | { ok: false; error: string } {
  const path = resolve(dir);
  migrateLegacyProject(path);
  const file = join(path, SCENE_FILE);
  let raw: unknown;
  try {
    if (!existsSync(file)) {
      mkdirSync(path, { recursive: true });
      writeFileSync(file, readFileSync(SAMPLE_SCENE, "utf8"));
    }
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { ok: false, error: `Could not open ${file}: ${(error as Error).message}` };
  }
  const parsed = parseScene(raw);
  if (!parsed.ok) return { ok: false, error: `${file}: ${parsed.error}` };
  return { ok: true, project: { name: basename(path), path }, doc: parsed.doc };
}

/** The scene of a new project: one ground level and nothing else, for importing into or drawing in. */
export function emptyScene(name: string): SceneDocument {
  return {
    version: 1,
    units: "mm",
    up: "Z",
    name,
    levels: [{ id: "L0", name: "Ground", elevation: 0 }],
    elements: {},
  };
}

/**
 * Creates a project in a folder with an empty scene, without opening it. A folder that already holds a project is left
 * alone: nothing is written and the answer says so.
 */
export function createProject(dir: string): { ok: true } | { ok: false; error: string } {
  const path = resolve(dir);
  migrateLegacyProject(path);
  const file = join(path, SCENE_FILE);
  if (existsSync(file))
    return {
      ok: false,
      error: `${path} already holds a project. Open it instead, or choose another folder.`,
    };
  try {
    mkdirSync(path, { recursive: true });
    writeFileSync(file, `${JSON.stringify(emptyScene(basename(path) || "Project"), null, 2)}\n`);
  } catch (error) {
    return { ok: false, error: `Could not create ${file}: ${(error as Error).message}` };
  }
  return { ok: true };
}

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Writes the scene atomically: a temporary file, then a rename over the real one. On Windows the rename fails
 * while another program (antivirus, an editor, OneDrive) holds the file, so it is retried with backoff.
 */
export async function writeSceneAtomic(
  dir: string,
  doc: SceneDocument,
  retries = [100, 300, 900],
  rename: (from: string, to: string) => void = renameSync,
): Promise<void> {
  const file = join(dir, SCENE_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  for (let attempt = 0; ; attempt++) {
    try {
      rename(tmp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      const wait = retries[attempt];
      if (!RETRYABLE.has(code) || wait === undefined) throw error;
      await sleep(wait);
    }
  }
}

/** Saves at most once per `delayMs` after the last change, so a drag does not write the file 30 times a second. */
export class Autosaver {
  private timer: NodeJS.Timeout | null = null;
  private pending: SceneDocument | null = null;
  savedAt: string | null = null;
  lastError: string | null = null;

  constructor(
    private readonly dir: string,
    private readonly onSaved: (savedAt: string | null, error: string | null) => void = () => {},
    private readonly delayMs = 2000,
  ) {}

  schedule(doc: SceneDocument): void {
    this.pending = doc;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const doc = this.pending;
    if (!doc) return;
    this.pending = null;
    try {
      await writeSceneAtomic(this.dir, doc);
      this.savedAt = new Date().toISOString();
      this.lastError = null;
    } catch (error) {
      this.lastError = `Could not save: ${(error as Error).message}`;
    }
    this.onSaved(this.savedAt, this.lastError);
  }
}

const settingsFile = (workspaceRoot: string) => join(workspaceRoot, ".hai", "settings.json");

/** Remembers the last opened project in .hai/settings.json. */
export function readLastProject(workspaceRoot: string): string | null {
  const last = readSettingsFile(settingsFile(workspaceRoot)).lastProject;
  return typeof last === "string" ? last : null;
}

export function writeLastProject(workspaceRoot: string, path: string): void {
  updateSettingsFile(settingsFile(workspaceRoot), { lastProject: path });
}

/** The project opened when none was remembered: a copy of the sample scene inside .hai. */
export const defaultProjectDir = (workspaceRoot: string) => join(workspaceRoot, ".hai", "projects", "sample");
