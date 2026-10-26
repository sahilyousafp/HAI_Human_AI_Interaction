import type { ContextRaster, Site } from "@hai/protocol";
import { siteBox } from "@hai/scene";
import { type OpenDataClient, OpenDataError } from "./client.ts";
import { openCog } from "./cog.ts";
import { rasterItem, type Stop } from "./ramp.ts";
import { crsFromEpsg, type ModelGrid, readSquare } from "./raster-grid.ts";
import { lastDays, type StacItem, searchStac } from "./stac.ts";

/** The most the radius may be for vegetation, metres: ten-metre pixels over a 2 km square is 40,000 cells. */
export const MAX_VEGETATION_RADIUS_M = 1000;

const WORLDCOVER = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map";
const EARTH_SEARCH = "https://earth-search.aws.element84.com/v1/search";
const LAND_COVER_TTL_MS = 30 * 24 * 3600_000;
const GREENNESS_TTL_MS = 24 * 3600_000;

/** The WorldCover classes the shares are given for. */
const CLASSES: Record<number, string> = {
  10: "tree",
  20: "shrub",
  30: "grass",
  40: "crop",
  50: "built",
  60: "bare",
  70: "snow",
  80: "water",
  90: "wetland",
  95: "mangrove",
  100: "moss",
};

/** The 3 degree tile of ESA WorldCover that holds a place, named as the dataset names it. */
export function worldCoverTile(lat: number, lon: number): { name: string; url: string } {
  const latTile = Math.floor(lat / 3) * 3;
  const lonTile = Math.floor(lon / 3) * 3;
  const ns = `${latTile >= 0 ? "N" : "S"}${String(Math.abs(latTile)).padStart(2, "0")}`;
  const ew = `${lonTile >= 0 ? "E" : "W"}${String(Math.abs(lonTile)).padStart(3, "0")}`;
  const name = `ESA_WorldCover_10m_2021_v200_${ns}${ew}_Map.tif`;
  return { name, url: `${WORLDCOVER}/${name}` };
}

/** How the land around the site is covered: the share of each class over the square, from the 10 m map. */
export interface LandCover {
  /** Fractions of the cells that have data, by class name (only classes present). */
  shares: Record<string, number>;
  /** Tree, shrub and grass cover together. */
  greenShare: number;
  /** How much of the requested square the map covered (1 when all of it). */
  coverage: number;
  radiusM: number;
  year: 2021;
  /** The metres one map pixel is. */
  pixelM: number;
}

/** The class shares of a grid of WorldCover values (NaN and 0 are no data). */
export function landCoverShares(grid: ModelGrid): {
  shares: Record<string, number>;
  greenShare: number;
  coverage: number;
} {
  const counts = new Map<string, number>();
  let valid = 0;
  for (const value of grid.values) {
    if (Number.isNaN(value)) continue;
    valid++;
    const name = CLASSES[value] ?? "other";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const shares: Record<string, number> = {};
  for (const [name, n] of [...counts].sort((a, b) => b[1] - a[1]))
    shares[name] = Math.round((n / valid) * 1000) / 1000;
  return {
    shares,
    greenShare:
      Math.round(
        (((counts.get("tree") ?? 0) + (counts.get("shrub") ?? 0) + (counts.get("grass") ?? 0)) /
          (valid || 1)) *
          1000,
      ) / 1000,
    coverage: Math.round((valid / grid.values.length) * 1000) / 1000,
  };
}

/** What a land cover result is saved under, so a later question can find it without asking again. */
export function landCoverKey(site: Site, radiusM: number): string {
  const tile = worldCoverTile(site.lat, site.lon);
  return `land-cover|${tile.name}|${site.lat.toFixed(5)}|${site.lon.toFixed(5)}|${site.northDeg}|${radiusM}`;
}

/** The saved land cover of this site and radius if one is still good (nothing is requested), else null. */
export function savedLandCover(client: OpenDataClient, site: Site, radiusM: number): LandCover | null {
  return (
    client.peekDerived<LandCover>("worldcover", landCoverKey(site, radiusM), LAND_COVER_TTL_MS)?.value ?? null
  );
}

/** The land cover around the site, from the ESA WorldCover 10 m map (2021), read as a window of its tile. */
export async function fetchLandCover(
  client: OpenDataClient,
  site: Site,
  radiusM: number,
): Promise<{ value: LandCover; fetchedAt: number; cached: boolean }> {
  if (radiusM > MAX_VEGETATION_RADIUS_M)
    throw new OpenDataError(
      "too-large",
      `The radius is limited to ${MAX_VEGETATION_RADIUS_M} m for vegetation.`,
    );
  const tile = worldCoverTile(site.lat, site.lon);
  const key = landCoverKey(site, radiusM);
  const made = await client.derived<LandCover>(
    "worldcover",
    "land cover",
    key,
    LAND_COVER_TTL_MS,
    async () => {
      const tiff = await openCog(client, "worldcover", tile.url, "land cover");
      const size = Math.min(200, Math.max(10, Math.round((2 * radiusM) / 10)));
      const grid = await readSquare(tiff, { kind: "geographic" }, site, radiusM, size, (raw, noData) =>
        raw === 0 || raw === noData ? Number.NaN : raw,
      );
      const { shares, greenShare, coverage } = landCoverShares(grid);
      if (coverage === 0)
        throw new OpenDataError("http", "The land cover map has no data for that place (open water or ice).");
      return {
        value: {
          shares,
          greenShare,
          coverage,
          radiusM,
          year: 2021 as const,
          pixelM: Math.round(grid.pixelM * 10) / 10,
        },
      };
    },
  );
  return { value: made.value, fetchedAt: made.fetchedAt, cached: made.cached };
}

/** The NDVI colours: brown and sand for bare ground, then greens. */
export const NDVI_STOPS: Stop[] = [
  { value: -0.1, color: "#8c6d4f" },
  { value: 0.1, color: "#d9c27a" },
  { value: 0.3, color: "#a8c66c" },
  { value: 0.6, color: "#3f9b4a" },
  { value: 0.9, color: "#0b5d2a" },
];

export interface Greenness {
  /** The scene it came from, with its date and cloud cover. */
  scene: { id: string; date: string; cloudPercent: number | null };
  mean: number;
  min: number;
  max: number;
  /** The share of cells whose NDVI is above 0.3 (green vegetation). */
  greenCellShare: number;
  pixelM: number;
  radiusM: number;
}

/** NDVI from the near-infrared and red reflectance; NaN where either is missing or both are zero. */
export function ndvi(nir: number, red: number): number {
  if (Number.isNaN(nir) || Number.isNaN(red)) return Number.NaN;
  const sum = nir + red;
  return sum <= 0 ? Number.NaN : Math.max(-1, Math.min(1, (nir - red) / sum));
}

/** The summary of a grid of NDVI values. */
export function greennessStats(grid: ModelGrid): {
  mean: number;
  min: number;
  max: number;
  greenCellShare: number;
  valid: number;
} {
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let green = 0;
  let valid = 0;
  for (const v of grid.values) {
    if (Number.isNaN(v)) continue;
    valid++;
    sum += v;
    min = Math.min(min, v);
    max = Math.max(max, v);
    if (v > 0.3) green++;
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return valid === 0
    ? { mean: Number.NaN, min: Number.NaN, max: Number.NaN, greenCellShare: 0, valid: 0 }
    : {
        mean: round(sum / valid),
        min: round(min),
        max: round(max),
        greenCellShare: round(green / valid),
        valid,
      };
}

/** The reflectance of a Sentinel-2 L2A band: its digital number times the scale plus the offset (0 is no data). */
const reflectance =
  (asset: { scale?: number; offset?: number } | undefined) => (raw: number, noData: number | null) =>
    raw === 0 || raw === noData ? Number.NaN : raw * (asset?.scale ?? 0.0001) + (asset?.offset ?? -0.1);

/**
 * The greenness around the site from the newest Sentinel-2 L2A scene with little cloud: NDVI over the square, as
 * statistics and as an overlay for the layer. Tries the newest scenes in turn until one covers the place.
 */
export async function fetchGreenness(
  client: OpenDataClient,
  site: Site,
  radiusM: number,
  options: { maxCloudPercent?: number; maxAgeDays?: number; now?: number; overlay?: boolean } = {},
): Promise<{
  value: Greenness;
  overlay: ContextRaster | null;
  fetchedAt: number;
  observedAt: number;
  cached: boolean;
}> {
  if (radiusM > MAX_VEGETATION_RADIUS_M)
    throw new OpenDataError(
      "too-large",
      `The radius is limited to ${MAX_VEGETATION_RADIUS_M} m for vegetation.`,
    );
  const cloud = options.maxCloudPercent ?? 15;
  const days = options.maxAgeDays ?? 60;
  const now = options.now ?? Date.now();
  const key = `greenness|${site.lat.toFixed(5)}|${site.lon.toFixed(5)}|${site.northDeg}|${radiusM}|${cloud}|${days}|${options.overlay ?? true}`;
  const made = await client.derived<{ value: Greenness; overlay: ContextRaster | null }>(
    "earth-search",
    "greenness",
    key,
    GREENNESS_TTL_MS,
    async () => {
      const box = siteBox(site, radiusM);
      const items = await searchStac(client, "earth-search", EARTH_SEARCH, {
        collections: ["sentinel-2-l2a"],
        bbox: [box.west, box.south, box.east, box.north],
        datetime: lastDays(days, now),
        limit: 8,
        query: { "eo:cloud_cover": { lt: cloud } },
        sortby: [{ field: "properties.datetime", direction: "desc" }],
      });
      if (items.length === 0)
        throw new OpenDataError(
          "http",
          `No Sentinel-2 scene with less than ${cloud}% cloud in the last ${days} days covers that place.`,
        );
      let lastError: unknown = null;
      for (const item of items) {
        try {
          const result = await greennessOf(client, item, site, radiusM, options.overlay ?? true);
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

async function greennessOf(
  client: OpenDataClient,
  item: StacItem,
  site: Site,
  radiusM: number,
  overlay: boolean,
): Promise<{ value: Greenness; overlay: ContextRaster | null }> {
  const red = item.assets.red;
  const nir = item.assets.nir;
  if (!red || !nir || item.epsg === null)
    throw new OpenDataError("content-type", `Scene ${item.id} has no red and near-infrared bands.`);
  const crs = crsFromEpsg(item.epsg);
  const size = Math.min(200, Math.max(10, Math.round((2 * radiusM) / 10)));
  const [redTiff, nirTiff] = await Promise.all([
    openCog(client, "earth-search", red.href, "greenness"),
    openCog(client, "earth-search", nir.href, "greenness"),
  ]);
  const [redGrid, nirGrid] = await Promise.all([
    readSquare(redTiff, crs, site, radiusM, size, reflectance(red)),
    readSquare(nirTiff, crs, site, radiusM, size, reflectance(nir)),
  ]);
  const values = new Float32Array(size * size);
  for (let i = 0; i < values.length; i++)
    values[i] = ndvi(nirGrid.values[i] as number, redGrid.values[i] as number);
  const grid: ModelGrid = { ...redGrid, values };
  const stats = greennessStats(grid);
  if (stats.valid === 0) throw new OpenDataError("http", `Scene ${item.id} has no data over that place.`);
  return {
    value: {
      scene: { id: item.id, date: item.datetime, cloudPercent: item.cloud },
      mean: stats.mean,
      min: stats.min,
      max: stats.max,
      greenCellShare: stats.greenCellShare,
      pixelM: Math.round(redGrid.pixelM * 10) / 10,
      radiusM,
    },
    overlay: overlay
      ? rasterItem(grid, {
          id: "ndvi",
          label: "Greenness (NDVI)",
          quantity: "NDVI, greenness of vegetation",
          unit: "index",
          source: "earth-search",
          date: item.datetime,
          anchorMm: site.anchorMm,
          radiusM,
          range: [-0.1, 0.9],
          stops: NDVI_STOPS,
        })
      : null,
  };
}
