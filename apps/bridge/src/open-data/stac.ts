import type { OpenDataClient } from "./client.ts";
import { OpenDataError } from "./client.ts";

/** A scene of a STAC catalogue, as much of it as the readers need. */
export interface StacItem {
  id: string;
  /** When it was taken (ISO 8601). */
  datetime: string;
  /** The scene's cloud cover, percent, when the catalogue says. */
  cloud: number | null;
  /** The EPSG code its rasters use. */
  epsg: number | null;
  /** The satellite or sensor platform, when the catalogue says ("landsat-9"). */
  platform: string | null;
  assets: Record<string, { href: string; scale?: number; offset?: number; nodata?: number }>;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** A scene from a STAC feature; a feature with no date or no assets is not one. */
export function parseItem(raw: unknown): StacItem | null {
  const feature = object(raw);
  const properties = object(feature.properties);
  const datetime = typeof properties.datetime === "string" ? properties.datetime : null;
  const assets: StacItem["assets"] = {};
  for (const [name, value] of Object.entries(object(feature.assets))) {
    const asset = object(value);
    if (typeof asset.href !== "string") continue;
    const band = object(
      Array.isArray(asset["raster:bands"]) ? (asset["raster:bands"] as unknown[])[0] : undefined,
    );
    assets[name] = {
      href: asset.href,
      ...(number(band.scale) !== undefined ? { scale: number(band.scale) as number } : {}),
      ...(number(band.offset) !== undefined ? { offset: number(band.offset) as number } : {}),
      ...(number(band.nodata) !== undefined ? { nodata: number(band.nodata) as number } : {}),
    };
  }
  if (!datetime || typeof feature.id !== "string" || Object.keys(assets).length === 0) return null;
  const code = properties["proj:code"];
  const epsg =
    number(properties["proj:epsg"]) ??
    (typeof code === "string" && /^EPSG:\d+$/.test(code) ? Number(code.slice(5)) : undefined);
  return {
    id: feature.id,
    datetime,
    cloud: number(properties["eo:cloud_cover"]) ?? null,
    epsg: epsg ?? null,
    platform: typeof properties.platform === "string" ? properties.platform : null,
    assets,
  };
}

/** Searches a STAC API for scenes, newest first. */
export async function searchStac(
  client: OpenDataClient,
  source: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<StacItem[]> {
  const response = await client.request({
    source,
    kind: "scene search",
    url: endpoint,
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    accept: ["application/json", "application/geo+json"],
    // A search for the newest scene is worth a few hours at most.
    ttlMs: 3 * 3600_000,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body.toString("utf8"));
  } catch {
    throw new OpenDataError("content-type", `${new URL(endpoint).hostname} did not answer with JSON.`);
  }
  const features = Array.isArray(object(parsed).features) ? (object(parsed).features as unknown[]) : [];
  return features.flatMap((f) => {
    const item = parseItem(f);
    return item ? [item] : [];
  });
}

/** The ISO range "from/to" of the last `days` days up to `now`. */
export function lastDays(days: number, now = Date.now()): string {
  return `${new Date(now - days * 86_400_000).toISOString()}/${new Date(now).toISOString()}`;
}
