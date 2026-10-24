import { randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AssetId, type SceneDocument } from "@hai/protocol";
import { readMeshHeader } from "@hai/scene";

export const ASSETS_DIR = "assets";
export const ASSET_EXTENSION = ".haimesh";
/** The most one asset may be; larger uploads are refused while they stream in. */
export const MAX_ASSET_BYTES = 500_000_000;
/** The header of an asset is a few hundred bytes per part; anything beyond this is not an asset. */
const MAX_HEADER_BYTES = 16_000_000;

export type AssetResult = { ok: true } | { ok: false; status: 400 | 409 | 413; error: string };

/**
 * Imported geometry stored beside the scene, in the open project's `assets` folder. Assets are addressed only by
 * id (a UUID checked here), so no path ever comes from a client. Writes stream to a temporary file and are renamed
 * into place only once the whole file has arrived within the size limit and its header checks out.
 */
export class AssetStore {
  /** `projectDir` is the open project folder, or null when no project is open (then nothing can be stored). */
  constructor(private readonly projectDir: () => string | null) {}

  private file(id: string): string | null {
    const dir = this.projectDir();
    return dir && AssetId.safeParse(id).success ? join(dir, ASSETS_DIR, `${id}${ASSET_EXTENSION}`) : null;
  }

  has(id: string): boolean {
    const file = this.file(id);
    return file !== null && existsSync(file);
  }

  size(id: string): number | null {
    const file = this.file(id);
    return file && existsSync(file) ? statSync(file).size : null;
  }

  read(id: string): Readable | null {
    const file = this.file(id);
    return file && existsSync(file) ? createReadStream(file) : null;
  }

  async write(id: string, body: Readable, limit = MAX_ASSET_BYTES): Promise<AssetResult> {
    const target = this.file(id);
    if (!AssetId.safeParse(id).success) return { ok: false, status: 400, error: "Not a valid asset id." };
    if (!target) return { ok: false, status: 409, error: "No project folder is open to keep the model in." };
    mkdirSync(join(target, ".."), { recursive: true });
    const temporary = `${target}.${randomUUID().slice(0, 8)}.tmp`;
    let received = 0;
    try {
      await pipeline(
        body,
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            received += chunk.length;
            if (received > limit) throw new TooLarge();
            yield chunk;
          }
        },
        createWriteStream(temporary),
      );
      const checked = await checkAsset(temporary, received);
      if (!checked.ok) {
        await rm(temporary, { force: true });
        return { ok: false, status: 400, error: checked.error };
      }
      await rename(temporary, target);
      return { ok: true };
    } catch (error) {
      await rm(temporary, { force: true });
      if (error instanceof TooLarge) {
        return {
          ok: false,
          status: 413,
          error: `The model is over the ${limit / 1e6} MB limit for imports.`,
        };
      }
      throw error;
    }
  }

  /** Removes one asset (the mirror drops a mesh when its object changes or goes). */
  remove(id: string): void {
    const file = this.file(id);
    if (file) rmSync(file, { force: true });
  }

  /** Removes every asset in this store. Only the Rhino mirror's store is ever cleared: a project's assets are swept. */
  clearAll(): void {
    const dir = this.projectDir();
    if (dir) rmSync(join(dir, ASSETS_DIR), { recursive: true, force: true });
  }

  /** Removes the assets no element refers to; returns how many. Called when a project opens. */
  sweep(doc: SceneDocument): number {
    const dir = this.projectDir();
    if (!dir) return 0;
    const folder = join(dir, ASSETS_DIR);
    if (!existsSync(folder)) return 0;
    const used = new Set(
      Object.values(doc.elements).flatMap((e) => (e.type === "imported" ? [e.asset] : [])),
    );
    let removed = 0;
    for (const name of readdirSync(folder)) {
      if (name.endsWith(".tmp")) {
        rmSync(join(folder, name), { force: true }); // an upload that never finished
        continue;
      }
      if (!name.endsWith(ASSET_EXTENSION)) continue;
      if (!used.has(name.slice(0, -ASSET_EXTENSION.length))) {
        rmSync(join(folder, name), { force: true });
        removed++;
      }
    }
    return removed;
  }

  /** The ids of the assets the scene refers to that are not in the folder. */
  missing(doc: SceneDocument): string[] {
    const ids = new Set(Object.values(doc.elements).flatMap((e) => (e.type === "imported" ? [e.asset] : [])));
    return [...ids].filter((id) => !this.has(id));
  }
}

class TooLarge extends Error {}

/** Checks the header of a stored file against its size, reading only the header. */
async function checkAsset(file: string, size: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const handle = await open(file, "r");
  try {
    const start = Buffer.alloc(12);
    const { bytesRead } = await handle.read(start, 0, 12, 0);
    if (bytesRead < 12) return { ok: false, error: "That is not a model file." };
    const headerLength = start.readUInt32LE(8);
    if (headerLength > MAX_HEADER_BYTES) return { ok: false, error: "That is not a model file." };
    const prefix = Buffer.alloc(12 + headerLength);
    await handle.read(prefix, 0, prefix.length, 0);
    const result = readMeshHeader(new Uint8Array(prefix.buffer, prefix.byteOffset, prefix.length), size);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } finally {
    await handle.close();
  }
}
