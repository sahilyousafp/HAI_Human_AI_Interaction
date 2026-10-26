import type { Site } from "@hai/protocol";
import { modelToGeo } from "@hai/scene";
import type { GeoTIFF } from "geotiff";
import { OpenDataError } from "./client.ts";
import { type Box, readWindow } from "./cog.ts";
import { lonLatToUtm } from "./utm.ts";

/** What a raster's coordinates are: degrees, or UTM metres in a zone. */
export type RasterCrs = { kind: "geographic" } | { kind: "utm"; zone: number };

/** The raster's CRS from an EPSG code: 4326, or a UTM zone (326xx north, 327xx south); anything else is refused. */
export function crsFromEpsg(epsg: number): RasterCrs {
  if (epsg === 4326) return { kind: "geographic" };
  if ((epsg >= 32601 && epsg <= 32660) || (epsg >= 32701 && epsg <= 32760))
    return { kind: "utm", zone: epsg % 100 };
  throw new OpenDataError(
    "content-type",
    `The raster uses EPSG:${epsg}, which is not read here (only 4326 and UTM).`,
  );
}

/** A place in the raster's own coordinates. */
export function toRasterXY(crs: RasterCrs, lon: number, lat: number): [number, number] {
  if (crs.kind === "geographic") return [lon, lat];
  const { easting, northing } = lonLatToUtm(lon, lat, crs.zone);
  return [easting, northing];
}

/** The model's square around the site, resampled onto a regular grid aligned to the model's own axes. */
export interface ModelGrid {
  /** `size` x `size` values, the first row at the top (the largest model y); NaN where the raster has no data. */
  values: Float32Array;
  size: number;
  /** The metres one cell covers. */
  cellM: number;
  /** The raster's own pixel size, in metres (what the data really resolves). */
  pixelM: number;
}

/**
 * Reads the raster over the square of half-side `radiusM` around the site and resamples it (nearest pixel) onto a
 * grid aligned to the model's axes, whatever way north points and whatever the raster's projection. `convert` turns a
 * raw pixel value into the quantity wanted (reflectance, degrees) or NaN for no data; `size` is the grid's side.
 */
export async function readSquare(
  tiff: GeoTIFF,
  crs: RasterCrs,
  site: Site,
  radiusM: number,
  size: number,
  convert: (raw: number, noData: number | null) => number,
  band = 0,
): Promise<ModelGrid> {
  const model = (xm: number, ym: number) => {
    const geo = modelToGeo(site, [site.anchorMm[0] + xm * 1000, site.anchorMm[1] + ym * 1000]);
    return toRasterXY(crs, geo.lon, geo.lat);
  };
  // The window that holds the square, however it is turned: the box of its four corners, with a pixel of margin.
  const corners = [
    model(-radiusM, -radiusM),
    model(radiusM, -radiusM),
    model(radiusM, radiusM),
    model(-radiusM, radiusM),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const image = await tiff.getImage();
  const [pixelX, pixelY] = (image.getResolution() as [number, number]).map(Math.abs) as [number, number];
  const box: Box = {
    minX: Math.min(...xs) - pixelX,
    maxX: Math.max(...xs) + pixelX,
    minY: Math.min(...ys) - pixelY,
    maxY: Math.max(...ys) + pixelY,
  };
  const window = await readWindow(tiff, box, band);
  const values = new Float32Array(size * size);
  const cellM = (2 * radiusM) / size;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      // The centre of the cell, in model metres from the anchor.
      const [x, y] = model(-radiusM + (col + 0.5) * cellM, radiusM - (row + 0.5) * cellM);
      const px = Math.floor((x - window.box.minX) / window.pixel[0]);
      const py = Math.floor((window.box.maxY - y) / window.pixel[1]);
      values[row * size + col] =
        px < 0 || py < 0 || px >= window.width || py >= window.height
          ? Number.NaN
          : convert(window.values[py * window.width + px] as number, window.noData);
    }
  }
  const metresPerPixel =
    crs.kind === "geographic" ? (window.pixel[1] as number) * 111_320 : (window.pixel[0] as number);
  return { values, size, cellM, pixelM: metresPerPixel };
}
