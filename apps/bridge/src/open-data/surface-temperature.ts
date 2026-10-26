import type { ContextRaster, Site } from "@hai/protocol";
import { siteBox } from "@hai/scene";
import { type OpenDataClient, OpenDataError } from "./client.ts";
import { openCog } from "./cog.ts";
import { rasterItem, type Stop } from "./ramp.ts";
import { crsFromEpsg, type ModelGrid, readSquare } from "./raster-grid.ts";
import { lastDays, type StacItem, searchStac } from "./stac.ts";

const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const SIGN = "https://planetarycomputer.microsoft.com/api/sas/v1/sign";
const TTL_MS = 24 * 3600_000;
/** The radius limit, metres: 30 m pixels over a 2 km square is a few thousand cells. */
export const MAX_SURFACE_RADIUS_M = 1000;

/** Landsat Collection 2 Level-2 surface temperature: kelvin = digital number x scale + offset. */
const DEFAULT_SCALE = 0.00341802;
const DEFAULT_OFFSET = 149.0;

/** Temperature colours from cool blue to hot red. */
export function temperatureStops(low: number, high: number): Stop[] {
  const span = high - low;
  return [
    { value: low, color: "#2b6cb0" },
    { value: low + span * 0.33, color: "#63b3a0" },
    { value: low + span * 0.55, color: "#f6e05e" },
    { value: low + span * 0.8, color: "#ed8936" },
    { value: high, color: "#c53030" },
  ];
}

export interface SurfaceTemperature {
  /** The scene it came from. */
  scene: { id: string; date: string; platform: string | null; cloudPercent: number | null };
  minC: number;
  meanC: number;
  maxC: number;
  /** The threshold asked for (degrees C) and the share of the cells above it. */
  threshold?: { c: number; shareAbove: number };
  /** The size of a pixel, metres (Landsat's thermal band is 100 m, resampled to 30 m). */
  pixelM: number;
  radiusM: number;
  /** What this is and is not. */
  note: string;
}

export const SURFACE_NOTE =
  "This is the temperature of the ground and roofs as seen from above at the moment of the scene (surface, not air temperature), and the scene is a moment in the past.";

/** The summary of a grid of surface temperatures (NaN is no data). */
export function temperatureStats(grid: ModelGrid, thresholdC?: number) {
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let above = 0;
  let valid = 0;
  for (const v of grid.values) {
    if (Number.isNaN(v)) continue;
    valid++;
    sum += v;
    min = Math.min(min, v);
    max = Math.max(max, v);
    if (thresholdC !== undefined && v > thresholdC) above++;
  }
  const round = (x: number) => Math.round(x * 10) / 10;
  return valid === 0
    ? null
    : {
        minC: round(min),
        meanC: round(sum / valid),
        maxC: round(max),
        shareAbove: thresholdC === undefined ? undefined : Math.round((above / valid) * 1000) / 1000,
        valid,
      };
}

/** Signs an asset address so it can be read (the service hands out the token to anyone, with no account). */
async function sign(client: OpenDataClient, href: string): Promise<string> {
  const response = await client.request({
    source: "planetary-computer",
    kind: "sign",
    url: `${SIGN}?href=${encodeURIComponent(href)}`,
    // A signed address is good for an hour or so and is never kept.
    ttlMs: 0,
  });
  try {
    const signed = (JSON.parse(response.body.toString("utf8")) as { href?: unknown }).href;
    if (typeof signed === "string") return signed;
  } catch {
    // fall through
  }
  throw new OpenDataError("content-type", "planetarycomputer.microsoft.com did not return a signed address.");
}

/**
 * The ground temperature around the site from the newest Landsat 8 or 9 Level-2 scene with little cloud: statistics,
 * and an overlay for the context layer. When no scene qualifies, the error says when the last scene was seen.
 */
export async function fetchSurfaceTemperature(
  client: OpenDataClient,
  site: Site,
  radiusM: number,
  options: { maxAgeDays?: number; maxCloudPercent?: number; thresholdC?: number; now?: number } = {},
): Promise<{
  value: SurfaceTemperature;
  overlay: ContextRaster;
  fetchedAt: number;
  observedAt: number;
  cached: boolean;
}> {
  if (radiusM > MAX_SURFACE_RADIUS_M)
    throw new OpenDataError(
      "too-large",
      `The radius is limited to ${MAX_SURFACE_RADIUS_M} m for surface temperature.`,
    );
  const days = options.maxAgeDays ?? 45;
  const cloud = options.maxCloudPercent ?? 20;
  const now = options.now ?? Date.now();
  const key = `surface|${site.lat.toFixed(5)}|${site.lon.toFixed(5)}|${site.northDeg}|${radiusM}|${days}|${cloud}|${options.thresholdC ?? ""}`;
  const made = await client.derived<{ value: SurfaceTemperature; overlay: ContextRaster }>(
    "planetary-computer",
    "surface temperature",
    key,
    TTL_MS,
    async () => {
      const box = siteBox(site, radiusM);
      const bbox = [box.west, box.south, box.east, box.north];
      const items = await searchStac(client, "planetary-computer", STAC, {
        collections: ["landsat-c2-l2"],
        bbox,
        datetime: lastDays(days, now),
        limit: 8,
        query: { "eo:cloud_cover": { lt: cloud }, platform: { in: ["landsat-8", "landsat-9"] } },
        sortby: [{ field: "properties.datetime", direction: "desc" }],
      });
      if (items.length === 0) {
        // Say when the last scene was, so the agent can tell the user what is missing.
        const last = await searchStac(client, "planetary-computer", STAC, {
          collections: ["landsat-c2-l2"],
          bbox,
          datetime: lastDays(180, now),
          limit: 1,
          query: { platform: { in: ["landsat-8", "landsat-9"] } },
          sortby: [{ field: "properties.datetime", direction: "desc" }],
        });
        const seen = last[0];
        throw new OpenDataError(
          "http",
          `No Landsat scene with less than ${cloud}% cloud in the last ${days} days covers that place.${
            seen
              ? ` The last scene seen was ${seen.datetime.slice(0, 10)}${seen.cloud !== null ? ` with ${seen.cloud}% cloud` : ""}.`
              : " No scene at all was found in the last 180 days."
          } No values are given.`,
        );
      }
      let lastError: unknown = null;
      for (const item of items) {
        try {
          const result = await temperatureOf(client, item, site, radiusM, options.thresholdC);
          return { value: result, observedAt: Date.parse(item.datetime) };
        } catch (error) {
          lastError = error;
          if (
            error instanceof OpenDataError &&
            ["off", "host-not-allowed", "private-address"].includes(error.code)
          )
            throw error;
        }
      }
      throw lastError instanceof Error ? lastError : new OpenDataError("http", "No scene could be read.");
    },
  );
  return {
    value: made.value.value,
    overlay: made.value.overlay,
    fetchedAt: made.fetchedAt,
    observedAt: made.observedAt ?? Date.parse(made.value.value.scene.date),
    cached: made.cached,
  };
}

async function temperatureOf(
  client: OpenDataClient,
  item: StacItem,
  site: Site,
  radiusM: number,
  thresholdC: number | undefined,
): Promise<{ value: SurfaceTemperature; overlay: ContextRaster }> {
  const asset = item.assets.lwir11;
  if (!asset || item.epsg === null)
    throw new OpenDataError("content-type", `Scene ${item.id} has no surface temperature band.`);
  const crs = crsFromEpsg(item.epsg);
  const tiff = await openCog(
    client,
    "planetary-computer",
    await sign(client, asset.href),
    "surface temperature",
  );
  const scale = asset.scale ?? DEFAULT_SCALE;
  const offset = asset.offset ?? DEFAULT_OFFSET;
  const size = Math.min(160, Math.max(10, Math.round((2 * radiusM) / 30)));
  const grid = await readSquare(tiff, crs, site, radiusM, size, (raw, noData) =>
    raw === 0 || raw === noData ? Number.NaN : raw * scale + offset - 273.15,
  );
  const stats = temperatureStats(grid, thresholdC);
  if (!stats) throw new OpenDataError("http", `Scene ${item.id} has no temperature data over that place.`);
  const low = Math.floor(stats.minC);
  const high = Math.max(Math.ceil(stats.maxC), low + 10);
  return {
    value: {
      scene: { id: item.id, date: item.datetime, platform: item.platform, cloudPercent: item.cloud },
      minC: stats.minC,
      meanC: stats.meanC,
      maxC: stats.maxC,
      ...(thresholdC !== undefined && stats.shareAbove !== undefined
        ? { threshold: { c: thresholdC, shareAbove: stats.shareAbove } }
        : {}),
      pixelM: 30,
      radiusM,
      note: SURFACE_NOTE,
    },
    overlay: rasterItem(grid, {
      id: "surface-temperature",
      label: "Ground temperature",
      quantity: "Surface temperature (not air)",
      unit: "degrees C",
      source: "planetary-computer",
      date: item.datetime,
      anchorMm: site.anchorMm,
      radiusM,
      range: [low, high],
      stops: temperatureStops(low, high),
    }),
  };
}
