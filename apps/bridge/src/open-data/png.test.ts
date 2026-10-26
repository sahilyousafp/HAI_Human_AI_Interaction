import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng, pngDataUrl } from "./png.ts";

describe("encodePng", () => {
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 10, 20, 30, 0]);
  const png = encodePng(pixels, 2, 2);

  it("starts with the PNG signature and a 2 by 2 RGBA header", () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
  });

  it("holds the rows, each after a filter byte, in its compressed data", () => {
    const at = png.indexOf("IDAT");
    const length = png.readUInt32BE(at - 4);
    const raw = inflateSync(png.subarray(at + 4, at + 4 + length));
    expect([...raw]).toEqual([0, 255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 255, 255, 10, 20, 30, 0]);
  });

  it("ends with IEND, and every chunk's checksum is right", () => {
    expect(png.subarray(-8, -4).toString("ascii")).toBe("IEND");
    let at = 8;
    while (at < png.length) {
      const length = png.readUInt32BE(at);
      const body = png.subarray(at + 4, at + 8 + length);
      const crc = png.readUInt32BE(at + 8 + length);
      // zlib's crc32 of the type and data.
      expect(crc).toBe(crc32(body) >>> 0);
      at += 12 + length;
    }
  });

  it("refuses pixels that do not fill the picture, and makes a data URL", () => {
    expect(() => encodePng(new Uint8Array(3), 2, 2)).toThrow(/fill/);
    expect(pngDataUrl(png).startsWith("data:image/png;base64,iVBOR")).toBe(true);
  });
});
