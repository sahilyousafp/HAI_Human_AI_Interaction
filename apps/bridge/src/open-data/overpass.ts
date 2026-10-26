import type { ContextBuilding, ContextTree, Site } from "@hai/protocol";
import { geoToModel, siteBox } from "@hai/scene";
import type { OpenDataClient } from "./client.ts";
import { OpenDataError } from "./client.ts";

const ENDPOINT = "https://overpass-api.de/api/interpreter";
/** Buildings are cached for a week: they change slowly, and the public server asks for little traffic. */
const TTL_MS = 7 * 24 * 3600_000;
/** A dense 2 km square can answer with several megabytes of geometry. */
const MAX_BYTES = 8 * 1024 * 1024;
/** What a building with no height and no levels is taken to be: three levels. */
export const DEFAULT_HEIGHT_MM = 9000;
/** What one level is worth when only the number of levels is known, mm. */
export const LEVEL_MM = 3000;

/** The most the radius may be, in metres: past this the answer is too large for one request. */
export const MAX_RADIUS_M = 2000;

/** The Overpass QL for the buildings (ways) and trees (nodes) inside a box. */
export function overpassQuery(
  box: { south: number; west: number; north: number; east: number },
  trees: boolean,
): string {
  const bbox = `${box.south.toFixed(6)},${box.west.toFixed(6)},${box.north.toFixed(6)},${box.east.toFixed(6)}`;
  return `[out:json][timeout:25];(way["building"](${bbox});${trees ? `node["natural"="tree"](${bbox});` : ""});out geom;`;
}

/**
 * A height tag in millimetres: "12", "12.5", "12 m", "12m", "40 ft", "40'" (feet). Anything else is no height. A
 * height of zero or less is no height either.
 */
export function parseHeightMm(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(m|meter|meters|metre|metres|ft|feet|')?\s*$/i.exec(value);
  if (!match) return null;
  const number = Number((match[1] as string).replace(",", "."));
  if (!Number.isFinite(number) || number <= 0) return null;
  const unit = (match[2] ?? "m").toLowerCase();
  return Math.round(number * (unit === "ft" || unit === "feet" || unit === "'" ? 304.8 : 1000));
}

/** A building's height and where it came from: its height tag, else its levels, else the default. */
export function buildingHeight(tags: Record<string, string>): {
  heightMm: number;
  heightSource: ContextBuilding["heightSource"];
} {
  const measured = parseHeightMm(tags.height);
  if (measured) return { heightMm: measured, heightSource: "measured" };
  const levels = Number(tags["building:levels"]);
  if (Number.isFinite(levels) && levels >= 1 && levels <= 200)
    return { heightMm: Math.round(levels * LEVEL_MM), heightSource: "inferred" };
  return { heightMm: DEFAULT_HEIGHT_MM, heightSource: "default" };
}

interface OsmElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  geometry?: Array<{ lat?: number; lon?: number }>;
  tags?: Record<string, string>;
}

export interface Fetched {
  buildings: ContextBuilding[];
  trees: ContextTree[];
  /** When the OpenStreetMap data behind the answer was current (ms), when the server says. */
  observedAt: number | null;
  fetchedAt: number;
  cached: boolean;
}

/** Turns the server's answer into the layer's items, in the site's model coordinates. */
export function parseOverpass(body: unknown, site: Site): Omit<Fetched, "fetchedAt" | "cached"> {
  const data = (body && typeof body === "object" ? body : {}) as {
    osm3s?: { timestamp_osm_base?: string };
    elements?: OsmElement[];
  };
  const buildings: ContextBuilding[] = [];
  const trees: ContextTree[] = [];
  for (const element of data.elements ?? []) {
    const tags = element.tags ?? {};
    if (element.type === "way" && tags.building && element.geometry) {
      const ring = element.geometry.flatMap((p) =>
        typeof p.lat === "number" && typeof p.lon === "number"
          ? [geoToModel(site, { lat: p.lat, lon: p.lon })]
          : [],
      );
      const first = ring[0];
      const last = ring.at(-1);
      const open = first && last && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
      if (open.length < 3 || open.length > 400) continue;
      const name = tags.name ?? tags["addr:housename"];
      buildings.push({
        id: `way/${element.id}`,
        kind: "building",
        footprint: open.map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]),
        ...buildingHeight(tags),
        baseMm: 0,
        source: "overpass",
        ...(name ? { label: name.slice(0, 120) } : {}),
      });
    } else if (
      element.type === "node" &&
      tags.natural === "tree" &&
      typeof element.lat === "number" &&
      typeof element.lon === "number"
    ) {
      const [x, y] = geoToModel(site, { lat: element.lat, lon: element.lon });
      const height = parseHeightMm(tags.height);
      trees.push({
        id: `node/${element.id}`,
        kind: "tree",
        position: [Math.round(x), Math.round(y)],
        ...(height && height <= 100_000 ? { heightMm: height } : {}),
        source: "overpass",
      });
    }
  }
  const stamp = data.osm3s?.timestamp_osm_base ? Date.parse(data.osm3s.timestamp_osm_base) : Number.NaN;
  return { buildings, trees, observedAt: Number.isFinite(stamp) ? stamp : null };
}

/** The buildings (and trees) within `radiusM` of the site, from the public Overpass server. */
export async function fetchBuildings(
  client: OpenDataClient,
  site: Site,
  radiusM: number,
  trees: boolean,
): Promise<Fetched> {
  if (radiusM > MAX_RADIUS_M)
    throw new OpenDataError(
      "too-large",
      `The radius is limited to ${MAX_RADIUS_M} m; ask for ${MAX_RADIUS_M} or less.`,
    );
  const query = overpassQuery(siteBox(site, radiusM), trees);
  const response = await client.request({
    source: "overpass",
    kind: "buildings",
    url: ENDPOINT,
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    ttlMs: TTL_MS,
    maxBytes: MAX_BYTES,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body.toString("utf8"));
  } catch {
    throw new OpenDataError("content-type", "overpass-api.de did not answer with JSON (it may be busy).");
  }
  return { ...parseOverpass(parsed, site), fetchedAt: response.fetchedAt, cached: response.cached };
}
