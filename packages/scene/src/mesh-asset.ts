import type { Point3Mm } from "@hai/protocol";

/**
 * The binary container for imported geometry (`assets/<id>.haimesh` in the project folder): a header that says what
 * the parts are, then their numbers. Positions are millimetres, little-endian Float32, three per vertex; indices are
 * Uint32, three per triangle.
 *
 *   bytes 0-7    "HAIMESH1"
 *   bytes 8-11   header length H (uint32), a multiple of 4
 *   next H       header, JSON padded with spaces: { "parts": [{ vertices, indices, position, index, bounds }] }
 *   then         data; `position` and `index` are byte offsets into it
 */
const MAGIC = "HAIMESH1";
/** What assets written while the project was still called AEX start with: same layout, still read. */
const LEGACY_MAGIC = "AEXMESH1";

export interface MeshPart {
  /** Three numbers per vertex, millimetres. */
  positions: Float32Array;
  /** Three vertex numbers per triangle. */
  indices: Uint32Array;
}

interface PartHeader {
  vertices: number;
  indices: number;
  position: number;
  index: number;
  bounds: { min: Point3Mm; max: Point3Mm };
}

export interface MeshHeader {
  parts: PartHeader[];
}

/** The bounding box of a part's vertices, millimetres. */
export function partBounds(part: MeshPart): { min: Point3Mm; max: Point3Mm } {
  const min: Point3Mm = [Infinity, Infinity, Infinity];
  const max: Point3Mm = [-Infinity, -Infinity, -Infinity];
  const p = part.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k] as number;
      if (v < (min[k] as number)) min[k] = v;
      if (v > (max[k] as number)) max[k] = v;
    }
  }
  return { min, max };
}

/** Packs parts into one asset. */
export function encodeMeshAsset(parts: MeshPart[]): Uint8Array {
  let offset = 0;
  const headers: PartHeader[] = parts.map((part) => {
    const header: PartHeader = {
      vertices: part.positions.length / 3,
      indices: part.indices.length,
      position: offset,
      index: offset + part.positions.byteLength,
      bounds: partBounds(part),
    };
    offset += part.positions.byteLength + part.indices.byteLength;
    return header;
  });
  let json = JSON.stringify({ parts: headers } satisfies MeshHeader);
  while ((MAGIC.length + 4 + json.length) % 4 !== 0) json += " ";
  const out = new Uint8Array(MAGIC.length + 4 + json.length + offset);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(MAGIC), 0);
  view.setUint32(MAGIC.length, json.length, true);
  out.set(new TextEncoder().encode(json), MAGIC.length + 4);
  const dataStart = MAGIC.length + 4 + json.length;
  parts.forEach((part, i) => {
    const h = headers[i] as PartHeader;
    out.set(
      new Uint8Array(part.positions.buffer, part.positions.byteOffset, part.positions.byteLength),
      dataStart + h.position,
    );
    out.set(
      new Uint8Array(part.indices.buffer, part.indices.byteOffset, part.indices.byteLength),
      dataStart + h.index,
    );
  });
  return out;
}

export type DecodeResult = { ok: true; header: MeshHeader; dataStart: number } | { ok: false; error: string };

/**
 * Reads and checks the header of an asset, without touching the numbers. `totalLength` is the whole asset's size when
 * `bytes` holds only its beginning (the header), so a big file can be checked without reading it all.
 */
export function readMeshHeader(bytes: Uint8Array, totalLength: number = bytes.length): DecodeResult {
  const magic = new TextDecoder().decode(bytes.subarray(0, MAGIC.length));
  if (bytes.length < MAGIC.length + 4 || (magic !== MAGIC && magic !== LEGACY_MAGIC)) {
    return { ok: false, error: "Not a HAI mesh asset" };
  }
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length, true);
  const dataStart = MAGIC.length + 4 + length;
  if (dataStart > bytes.length) return { ok: false, error: "The mesh asset header is cut short" };
  let header: MeshHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(MAGIC.length + 4, dataStart)));
  } catch {
    return { ok: false, error: "The mesh asset header is not valid" };
  }
  const dataLength = totalLength - dataStart;
  for (const p of header.parts ?? []) {
    const end = p.index + p.indices * 4;
    if (p.position + p.vertices * 12 > p.index || end > dataLength || p.indices % 3 !== 0) {
      return { ok: false, error: "The mesh asset is cut short or inconsistent" };
    }
  }
  if (!Array.isArray(header.parts)) return { ok: false, error: "The mesh asset has no parts" };
  return { ok: true, header, dataStart };
}

/** Unpacks every part of an asset (the arrays look into the given bytes when aligned, else are copies). */
export function decodeMeshAsset(
  bytes: Uint8Array,
): { ok: true; parts: MeshPart[] } | { ok: false; error: string } {
  const read = readMeshHeader(bytes);
  if (!read.ok) return read;
  const { header, dataStart } = read;
  const parts = header.parts.map((p) => {
    const at = bytes.byteOffset + dataStart;
    // Views onto the bytes when they are aligned (a fetched file is), so a big model is not copied.
    const aligned = (at + p.position) % 4 === 0 && (at + p.index) % 4 === 0;
    const buffer = bytes.buffer as ArrayBuffer;
    return aligned
      ? {
          positions: new Float32Array(buffer, at + p.position, p.vertices * 3),
          indices: new Uint32Array(buffer, at + p.index, p.indices),
        }
      : {
          positions: new Float32Array(buffer.slice(at + p.position, at + p.position + p.vertices * 12)),
          indices: new Uint32Array(buffer.slice(at + p.index, at + p.index + p.indices * 4)),
        };
  });
  return { ok: true, parts };
}
