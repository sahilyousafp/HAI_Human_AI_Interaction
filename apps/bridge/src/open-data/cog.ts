import { BaseClient, BaseResponse, fromCustomClient, type GeoTIFF } from "geotiff";
import { type OpenDataClient, OpenDataError, type OpenDataResponse } from "./client.ts";

/** One range of a file, fetched through the guarded client. */
type RangeFetcher = (range: string) => Promise<OpenDataResponse>;

class RangeResponse extends BaseResponse {
  constructor(private readonly answer: OpenDataResponse) {
    super();
  }
  override get status() {
    return this.answer.status;
  }
  override getHeader(name: string): string | undefined {
    return this.answer.headers[name.toLowerCase()];
  }
  override async getData(): Promise<ArrayBuffer> {
    const { buffer, byteOffset, byteLength } = this.answer.body;
    return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
  }
}

/** The reader's way to a file on an object store: every range goes through the client, so every limit applies. */
class RangeClient extends BaseClient {
  constructor(
    url: string,
    private readonly fetchRange: RangeFetcher,
  ) {
    super(url);
  }
  override async request(options?: RequestInit): Promise<BaseResponse> {
    const headers = (options?.headers ?? {}) as Record<string, string>;
    const range = headers.Range ?? headers.range;
    if (!range)
      throw new OpenDataError("http", "The raster reader asked for a whole file; only ranges are allowed.");
    return new RangeResponse(await this.fetchRange(range));
  }
}

/** The most bytes of one range (a block of the file or a tile). */
const RANGE_BYTES = 4 * 1024 * 1024;

/** Content types an object store gives a GeoTIFF. */
const TIFF_TYPES = [
  "image/tiff",
  "image/geotiff",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-geotiff",
];

/** Opens a Cloud Optimized GeoTIFF for windowed reads; nothing is downloaded but the ranges the reads need. */
export function openCog(client: OpenDataClient, source: string, url: string, kind: string): Promise<GeoTIFF> {
  return fromCustomClient(
    new RangeClient(url, (range) =>
      client.request({
        source,
        kind,
        url,
        headers: { range },
        accept: TIFF_TYPES,
        maxBytes: RANGE_BYTES,
        // Object stores are built for many small requests; the pacing meant for small servers is not needed.
        gapMs: 0,
        ttlMs: 0,
      }),
    ),
    { allowFullFile: false },
  ) as Promise<GeoTIFF>;
}

/** A box in the raster's own coordinates (degrees for a geographic raster, metres for a projected one). */
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Window {
  /** The values, row by row from the top (north), of one band. */
  values: ArrayLike<number>;
  width: number;
  height: number;
  /** The box the window really covers, in the raster's coordinates (whole pixels). */
  box: Box;
  /** The value that means "no data", when the file says. */
  noData: number | null;
  /** Pixel size in the raster's units. */
  pixel: [number, number];
}

/**
 * Reads the pixels of one band inside a box. The raster is read at its own resolution (the largest image of the file),
 * and a box the raster does not cover is refused, with how far off it was.
 */
export async function readWindow(tiff: GeoTIFF, box: Box, band = 0, maxPixels = 1_000_000): Promise<Window> {
  const image = await tiff.getImage();
  const [originX, originY] = image.getOrigin() as [number, number];
  const [resX, resY] = image.getResolution() as [number, number];
  const pixelX = Math.abs(resX);
  const pixelY = Math.abs(resY);
  const width = image.getWidth();
  const height = image.getHeight();
  // A box edge that falls on a pixel edge (to rounding) does not take in the next pixel.
  const EPSILON = 1e-6;
  const left = Math.max(0, Math.floor((box.minX - originX) / pixelX + EPSILON));
  const right = Math.min(width, Math.ceil((box.maxX - originX) / pixelX - EPSILON));
  const top = Math.max(0, Math.floor((originY - box.maxY) / pixelY + EPSILON));
  const bottom = Math.min(height, Math.ceil((originY - box.minY) / pixelY - EPSILON));
  if (right <= left || bottom <= top)
    throw new OpenDataError("http", "The raster does not cover that place.");
  if ((right - left) * (bottom - top) > maxPixels)
    throw new OpenDataError(
      "too-large",
      "That area is too large to read at the raster's resolution; ask for a smaller radius.",
    );
  const [values] = (await image.readRasters({
    window: [left, top, right, bottom],
    samples: [band],
  })) as unknown as [ArrayLike<number>];
  const noData = image.getGDALNoData();
  return {
    values,
    width: right - left,
    height: bottom - top,
    box: {
      minX: originX + left * pixelX,
      maxX: originX + right * pixelX,
      maxY: originY - top * pixelY,
      minY: originY - bottom * pixelY,
    },
    noData: typeof noData === "number" ? noData : null,
    pixel: [pixelX, pixelY],
  };
}
