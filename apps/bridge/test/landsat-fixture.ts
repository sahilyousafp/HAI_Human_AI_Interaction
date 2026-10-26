import type { RawResponse, Transport } from "../src/open-data/client.ts";
import { lonLatToUtm } from "../src/open-data/utm.ts";
import { makeGeoTiff, serveRange } from "./geotiff-fixture.ts";

/** The place of the fixture's scene, and the moment it is "now" for it (a week after the scene). */
export const LANDSAT_PLACE = { lat: 52.37, lon: 4.9 } as const;
export const LANDSAT_NOW = Date.parse("2026-10-25T12:00:00Z");

/** Kelvin to a digital number of the Landsat surface temperature band. */
const dn = (celsius: number) => Math.round((celsius + 273.15 - 149) / 0.00341802);

/** A 30 m UTM raster around the place: the west half is 24 degrees, the east half 36, the top row of the east half no data. */
const band = (() => {
  const centre = lonLatToUtm(LANDSAT_PLACE.lon, LANDSAT_PLACE.lat, 31);
  const size = 100;
  const values = Array.from({ length: size * size }, (_, i) => {
    const col = i % size;
    const row = Math.floor(i / size);
    if (col >= size / 2 && row === 0) return 0;
    return dn(col < size / 2 ? 24 : 36);
  });
  return makeGeoTiff({
    width: size,
    height: size,
    west: centre.easting - (size / 2) * 30,
    north: centre.northing + (size / 2) * 30,
    pixel: 30,
    values,
    epsg: 32631,
    type: "u16",
  });
})();

export const PC_ASSET =
  "https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/2026/198/023/x/lwir11.TIF";

/** A STAC item of a Landsat scene, as the Planetary Computer returns it. */
export const landsatItem = (id: string, date: string, cloud: number, platform = "landsat-9") => ({
  id,
  properties: { datetime: date, "eo:cloud_cover": cloud, "proj:epsg": 32631, platform },
  assets: { lwir11: { href: PC_ASSET, "raster:bands": [{ scale: 0.00341802, offset: 149, nodata: 0 }] } },
});

export interface LandsatOptions {
  /** The scenes a search with a cloud limit returns. */
  qualifying?: unknown[];
  /** The scenes a search without one returns (to tell the user when the last one was). */
  anyScene?: unknown[];
  signFails?: boolean;
  /** Every request made, for assertions. */
  calls?: Array<{ method: string; url: string; body?: string | undefined }>;
}

/** The Planetary Computer's search and sign endpoints and the blob store holding the temperature band. */
export function landsatTransport(options: LandsatOptions = {}): Transport {
  const json = (value: unknown): RawResponse => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify(value)),
  });
  return async (url, init) => {
    options.calls?.push({ method: init.method, url: url.href, ...(init.body ? { body: init.body } : {}) });
    if (url.hostname === "planetarycomputer.microsoft.com" && url.pathname.endsWith("/search")) {
      const asked = JSON.parse(init.body ?? "{}") as { query?: Record<string, unknown> };
      return json({
        features: asked.query?.["eo:cloud_cover"] ? (options.qualifying ?? []) : (options.anyScene ?? []),
      });
    }
    if (url.hostname === "planetarycomputer.microsoft.com" && url.pathname.endsWith("/sign"))
      return options.signFails
        ? { status: 500, headers: {}, body: Buffer.alloc(0) }
        : json({ href: `${url.searchParams.get("href")}?sv=2024&sig=TOKEN`, expiry: "2026-10-25T13:00:00Z" });
    if (url.hostname === "landsateuwest.blob.core.windows.net") return serveRange(band, init.headers.range);
    return { status: 404, headers: {}, body: Buffer.alloc(0) };
  };
}
