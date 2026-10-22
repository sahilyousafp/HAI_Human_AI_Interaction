import { describe, expect, it } from "vitest";
import { decodeMeshAsset, encodeMeshAsset, type MeshPart, partBounds, readMeshHeader } from "./mesh-asset.ts";

const triangle = (dx = 0): MeshPart => ({
  positions: new Float32Array([dx, 0, 0, dx + 1000, 0, 0, dx, 2000, 500]),
  indices: new Uint32Array([0, 1, 2]),
});

describe("mesh asset", () => {
  it("round-trips several parts", () => {
    const parts = [triangle(), triangle(5000)];
    const bytes = encodeMeshAsset(parts);
    expect(bytes.length % 4).toBe(0);
    const decoded = decodeMeshAsset(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.parts).toHaveLength(2);
    expect(Array.from(decoded.parts[1]?.positions ?? [])).toEqual(Array.from(parts[1]?.positions ?? []));
    expect(Array.from(decoded.parts[1]?.indices ?? [])).toEqual([0, 1, 2]);
  });

  it("records each part's bounding box in the header", () => {
    const read = readMeshHeader(encodeMeshAsset([triangle(5000)]));
    expect(read.ok && read.header.parts[0]?.bounds).toEqual({ min: [5000, 0, 0], max: [6000, 2000, 500] });
    expect(partBounds(triangle())).toEqual({ min: [0, 0, 0], max: [1000, 2000, 500] });
  });

  it("decodes from a view into a bigger buffer", () => {
    const bytes = encodeMeshAsset([triangle()]);
    const padded = new Uint8Array(bytes.length + 16);
    padded.set(bytes, 8);
    const decoded = decodeMeshAsset(padded.subarray(8, 8 + bytes.length));
    expect(decoded.ok && decoded.parts[0]?.positions[3]).toBe(1000);
  });

  it("refuses bytes that are not an asset, or are cut short", () => {
    expect(readMeshHeader(new TextEncoder().encode("hello, world")).ok).toBe(false);
    const bytes = encodeMeshAsset([triangle()]);
    expect(readMeshHeader(bytes.subarray(0, bytes.length - 4)).ok).toBe(false);
    expect(readMeshHeader(bytes.subarray(0, 14)).ok).toBe(false);
  });

  it("an empty asset has no parts", () => {
    const decoded = decodeMeshAsset(encodeMeshAsset([]));
    expect(decoded).toEqual({ ok: true, parts: [] });
  });
});
