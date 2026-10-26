import { writeArrayBuffer } from "geotiff";

export interface Fixture {
  width: number;
  height: number;
  /** The top-left corner and the pixel size, in the raster's units. */
  west: number;
  north: number;
  pixel: number;
  values: ArrayLike<number>;
  /** 4326 for degrees, or a projected code such as 32631. */
  epsg: number;
  /** "u8", "u16" or "f32". */
  type?: "u8" | "u16" | "f32";
  noData?: number;
}

/** A small GeoTIFF as bytes, as an object store would serve it. */
export function makeGeoTiff(f: Fixture): Buffer {
  const type = f.type ?? "u8";
  const bits = { u8: 8, u16: 16, f32: 32 }[type];
  const format = type === "f32" ? 3 : 1;
  const geographic = f.epsg === 4326;
  const metadata: Record<string, unknown> = {
    width: f.width,
    height: f.height,
    BitsPerSample: [bits],
    SampleFormat: [format],
    ModelPixelScale: [f.pixel, f.pixel, 0],
    ModelTiepoint: [0, 0, 0, f.west, f.north, 0],
    GTRasterTypeGeoKey: 1,
    ...(geographic
      ? { GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 4326 }
      : { GTModelTypeGeoKey: 1, ProjectedCSTypeGeoKey: f.epsg }),
    ...(f.noData !== undefined ? { GDAL_NODATA: String(f.noData) } : {}),
  };
  // The writer takes the width of a sample from the array it is given.
  const typed = { u8: Uint8Array, u16: Uint16Array, f32: Float32Array }[type].from(Array.from(f.values));
  const buffer = writeArrayBuffer(typed, metadata as never);
  return Buffer.from(buffer as ArrayBuffer);
}

/** Serves ranges of a file like an object store: 206 with a content-range, or the whole file for no range. */
export function serveRange(file: Buffer, range: string | undefined) {
  const match = range ? /^bytes=(\d+)-(\d+)?$/.exec(range) : null;
  if (!match)
    return {
      status: 200,
      headers: { "content-type": "image/tiff" } as Record<string, string | undefined>,
      body: file,
    };
  const start = Number(match[1]);
  const end = Math.min(file.length - 1, match[2] ? Number(match[2]) : file.length - 1);
  return {
    status: 206,
    headers: {
      "content-type": "image/tiff",
      "content-range": `bytes ${start}-${end}/${file.length}`,
      "content-length": String(end - start + 1),
    } as Record<string, string | undefined>,
    body: file.subarray(start, end + 1),
  };
}
