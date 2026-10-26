import { STARTER_PORTALS } from "@hai/protocol";
import type { OpenDataClient } from "./client.ts";
import { OpenDataError } from "./client.ts";

export type PortalKind = "ckan" | "socrata" | "arcgis-hub";

/** A dataset of a portal's catalogue, as an agent is told about it. */
export interface PortalDataset {
  id: string;
  title: string;
  description?: string;
  publisher?: string;
  licence?: string;
  /** When the portal says it was last updated. */
  updated?: string;
  /** The formats it is published in, where the portal says. */
  formats: string[];
  /** The dataset's page or download address, where the portal gives one. */
  url?: string;
  /** For CKAN: the ids of resources that can be read as a table, and for others the id to pass to `open_data_get`. */
  resources?: Array<{ id: string; format: string; table: boolean }>;
}

/** A table, cut to the limit. */
export interface PortalTable {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** How many rows the dataset has, when the portal says. */
  total?: number;
  /** Set when rows were left out because of the limit. */
  truncated: boolean;
}

/** The most rows a table read returns. */
export const TABLE_ROW_LIMIT = 200;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** What a host is in the starter list, or null for a host the user added. */
export function starterKind(host: string): PortalKind | null {
  return STARTER_PORTALS.find((p) => p.host === host)?.kind ?? null;
}

type Parsed<T> = { data: T; response: { fetchedAt: number; cached: boolean } };

/** A request to one portal host: its answer parsed as JSON. */
async function json<T = unknown>(client: OpenDataClient, url: string, kind: string): Promise<Parsed<T>> {
  const response = await client.request({ source: "portals", kind, url, ttlMs: 24 * 3600_000 });
  try {
    return { data: JSON.parse(response.body.toString("utf8")) as T, response };
  } catch {
    throw new OpenDataError("content-type", `${new URL(url).hostname} did not answer with JSON.`);
  }
}

// CKAN ---------------------------------------------------------------------------------------------------------------

function ckanDataset(raw: unknown, host: string): PortalDataset {
  const r = object(raw);
  const resources = array(r.resources).map((x) => {
    const res = object(x);
    const format = (asString(res.format) ?? "").toUpperCase();
    return { id: asString(res.id) ?? "", format, table: res.datastore_active === true };
  });
  const org = object(r.organization);
  const name = asString(r.name);
  return {
    id: asString(r.id) ?? name ?? "",
    title: asString(r.title) ?? name ?? "(untitled)",
    ...(asString(r.notes) ? { description: (asString(r.notes) as string).slice(0, 400) } : {}),
    ...(asString(org.title) ? { publisher: asString(org.title) as string } : {}),
    ...(asString(r.license_title) ? { licence: asString(r.license_title) as string } : {}),
    ...(asString(r.metadata_modified) ? { updated: asString(r.metadata_modified) as string } : {}),
    formats: [...new Set(resources.map((x) => x.format).filter(Boolean))],
    ...(name ? { url: `https://${host}/dataset/${encodeURIComponent(name)}` } : {}),
    resources: resources.filter((x) => x.id),
  };
}

// Socrata ------------------------------------------------------------------------------------------------------------

function socrataDataset(raw: unknown, host: string): PortalDataset {
  const r = object(raw);
  const resource = object(r.resource);
  const metadata = object(r.metadata);
  const id = asString(resource.id) ?? "";
  return {
    id,
    title: asString(resource.name) ?? id,
    ...(asString(resource.description)
      ? { description: (asString(resource.description) as string).slice(0, 400) }
      : {}),
    ...(asString(resource.attribution) ? { publisher: asString(resource.attribution) as string } : {}),
    ...(asString(metadata.license) ? { licence: asString(metadata.license) as string } : {}),
    ...(asString(resource.updatedAt) ? { updated: asString(resource.updatedAt) as string } : {}),
    formats: ["JSON", "CSV"],
    url: asString(r.link) ?? `https://${host}/d/${id}`,
    resources: [{ id, format: "JSON", table: true }],
  };
}

// ArcGIS Hub ---------------------------------------------------------------------------------------------------------

function hubDataset(raw: unknown): PortalDataset {
  const feature = object(raw);
  const p = object(feature.properties);
  const id = asString(feature.id) ?? asString(p.id) ?? "";
  return {
    id,
    title: asString(p.title) ?? id,
    ...(asString(p.description) ? { description: (asString(p.description) as string).slice(0, 400) } : {}),
    ...(asString(p.owner) ? { publisher: asString(p.owner) as string } : {}),
    ...(asString(p.license) ? { licence: asString(p.license) as string } : {}),
    ...(asString(p.modified) ? { updated: asString(p.modified) as string } : {}),
    formats: array(p.typeKeywords)
      .filter((x): x is string => typeof x === "string")
      .slice(0, 4),
    ...(asString(p.url) ? { url: asString(p.url) as string } : {}),
  };
}

/** The catalogue search URL of a portal of this kind. */
export function searchUrl(host: string, kind: PortalKind, query: string, limit: number): string {
  const q = encodeURIComponent(query);
  switch (kind) {
    case "ckan":
      return `https://${host}/api/3/action/package_search?q=${q}&rows=${limit}`;
    case "socrata":
      return `https://${host}/api/catalog/v1?q=${q}&limit=${limit}&only=datasets`;
    case "arcgis-hub":
      return `https://${host}/api/search/v1/collections/dataset/items?q=${q}&limit=${limit}`;
  }
}

/** Searches one portal's catalogue for datasets by text. */
export async function searchPortal(
  client: OpenDataClient,
  host: string,
  kind: PortalKind,
  query: string,
  limit: number,
): Promise<{ datasets: PortalDataset[]; total?: number; fetchedAt: number; cached: boolean }> {
  const { data, response } = await json(client, searchUrl(host, kind, query, limit), "portal search");
  const body = object(data);
  switch (kind) {
    case "ckan": {
      const result = object(body.result);
      return {
        datasets: array(result.results).map((x) => ckanDataset(x, host)),
        ...(typeof result.count === "number" ? { total: result.count } : {}),
        fetchedAt: response.fetchedAt,
        cached: response.cached,
      };
    }
    case "socrata":
      return {
        datasets: array(body.results).map((x) => socrataDataset(x, host)),
        ...(typeof body.resultSetSize === "number" ? { total: body.resultSetSize } : {}),
        fetchedAt: response.fetchedAt,
        cached: response.cached,
      };
    case "arcgis-hub":
      return {
        datasets: array(body.features).map(hubDataset),
        ...(typeof body.numberMatched === "number" ? { total: body.numberMatched } : {}),
        fetchedAt: response.fetchedAt,
        cached: response.cached,
      };
  }
}

/**
 * Probes an unknown portal for its kind: the first platform whose catalogue answers. Used for a host the user added,
 * which has no kind in the starter list.
 */
export async function detectKind(client: OpenDataClient, host: string): Promise<PortalKind> {
  const errors: string[] = [];
  for (const kind of ["ckan", "socrata", "arcgis-hub"] as const) {
    try {
      const found = await searchPortal(client, host, kind, "data", 1);
      if (found.datasets.length > 0 || found.total !== undefined) return kind;
    } catch (error) {
      if (
        error instanceof OpenDataError &&
        ["off", "host-not-allowed", "private-address", "paused"].includes(error.code)
      )
        throw error;
      errors.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new OpenDataError(
    "http",
    `${host} did not answer as a CKAN, Socrata or ArcGIS Hub catalogue (${errors.join("; ")}). Name the kind if you know it.`,
  );
}

const columnsOf = (rows: Array<Record<string, unknown>>) => {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
};

/** Reads a dataset's table from the portal that lists it, at most `limit` rows. */
export async function readDataset(
  client: OpenDataClient,
  host: string,
  kind: PortalKind,
  dataset: string,
  resource: string | undefined,
  limit: number,
): Promise<{ table: PortalTable; fetchedAt: number; cached: boolean }> {
  const rows = Math.min(limit, TABLE_ROW_LIMIT);
  switch (kind) {
    case "ckan": {
      const id = resource ?? dataset;
      const url = `https://${host}/api/3/action/datastore_search?resource_id=${encodeURIComponent(id)}&limit=${rows + 1}`;
      const { data, response } = await json(client, url, "dataset");
      const result = object(object(data).result);
      const records = array(result.records).map(object);
      const fields = array(result.fields)
        .map((f) => asString(object(f).id))
        .filter((x): x is string => x !== undefined && x !== "_id" && x !== "_full_text");
      return {
        table: {
          columns: fields.length > 0 ? fields : columnsOf(records),
          rows: records.slice(0, rows),
          ...(typeof result.total === "number" ? { total: result.total } : {}),
          truncated: records.length > rows || (typeof result.total === "number" && result.total > rows),
        },
        fetchedAt: response.fetchedAt,
        cached: response.cached,
      };
    }
    case "socrata": {
      const url = `https://${host}/resource/${encodeURIComponent(dataset)}.json?$limit=${rows + 1}`;
      const { data, response } = await json(client, url, "dataset");
      const records = array(data).map(object);
      return {
        table: {
          columns: columnsOf(records),
          rows: records.slice(0, rows),
          truncated: records.length > rows,
        },
        fetchedAt: response.fetchedAt,
        cached: response.cached,
      };
    }
    case "arcgis-hub":
      throw new OpenDataError(
        "http",
        `ArcGIS Hub lists datasets but serves their features from other hosts (a feature service). Add that host to the portals in Settings > Open data to read it, or search for another source.`,
      );
  }
}
