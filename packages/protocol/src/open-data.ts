import { z } from "zod";

/** The project's place on Earth: where the model's anchor point stands, and which way true north points. */
export const Site = z.strictObject({
  /** Degrees, north positive. */
  lat: z.number().min(-90).max(90),
  /** Degrees, east positive. */
  lon: z.number().min(-180).max(180),
  /** The angle of true north counter-clockwise from the model's +Y axis, in degrees (0: +Y is north). */
  northDeg: z.number().min(-180).max(180).default(0),
  /** The model point, in millimetres, that stands at `lat`, `lon` (the origin by default). */
  anchorMm: z.tuple([z.number(), z.number()]).default([0, 0]),
});
export type Site = z.infer<typeof Site>;

/** A source of open data that the Open data switch may allow. Hosts are the only hosts it ever contacts. */
export interface OpenDataSource {
  id: string;
  name: string;
  /** The hosts the source lives on (a portal source has none of its own: the user's and the starter list's are used). */
  hosts: readonly string[];
  provides: string;
  licence: string;
  /** What the licence asks to be shown next to the data. */
  attribution: string;
  /** Set when the free service is limited to non-commercial use: the source stays off until the user acknowledges it. */
  limit?: string;
}

/**
 * Every source the app can contact, in the order Settings lists them. Hosts and terms are those of the adapter that
 * uses them; an adapter's terms are re-read when it is written (see docs/open-data.md).
 */
export const OPEN_DATA_SOURCES: readonly OpenDataSource[] = [
  {
    id: "met-norway",
    name: "MET Norway",
    hosts: ["api.met.no"],
    provides: "Weather now and the forecast, worldwide",
    licence: "CC BY 4.0 and NLOD",
    attribution: "Weather data from MET Norway",
  },
  {
    id: "nws",
    name: "US National Weather Service",
    hosts: ["api.weather.gov"],
    provides: "Weather now and the forecast, United States",
    licence: "US government data, public domain",
    attribution: "Data from the US National Weather Service",
  },
  {
    id: "open-meteo",
    name: "Open-Meteo",
    hosts: ["api.open-meteo.com"],
    provides: "Weather now and the forecast, worldwide",
    licence: "CC BY 4.0 (data)",
    attribution: "Weather data by Open-Meteo.com",
    limit: "The free Open-Meteo service may be used for non-commercial purposes only.",
  },
  {
    id: "nasa-power",
    name: "NASA POWER",
    hosts: ["power.larc.nasa.gov"],
    provides: "Climate normals and solar radiation, worldwide",
    licence: "NASA open data",
    attribution: "Data from the NASA Langley Research Center POWER Project",
  },
  {
    id: "overpass",
    name: "OpenStreetMap (Overpass)",
    hosts: ["overpass-api.de"],
    provides: "Buildings with heights, and trees",
    licence: "ODbL 1.0",
    attribution: "Map data from OpenStreetMap contributors",
  },
  {
    id: "worldcover",
    name: "ESA WorldCover",
    hosts: ["esa-worldcover.s3.eu-central-1.amazonaws.com"],
    provides: "Land cover at 10 m (tree, shrub and grass cover)",
    licence: "CC BY 4.0",
    attribution: "ESA WorldCover 2021 (Copernicus Sentinel data processed by the ESA WorldCover consortium)",
  },
  {
    id: "earth-search",
    name: "Sentinel-2 (Earth Search)",
    hosts: ["earth-search.aws.element84.com", "sentinel-cogs.s3.us-west-2.amazonaws.com"],
    provides: "Greenness (NDVI) from the latest cloud-free Sentinel-2 scene",
    licence: "Copernicus Sentinel data, open",
    attribution: "Contains modified Copernicus Sentinel data",
  },
  {
    id: "planetary-computer",
    name: "Landsat (Planetary Computer)",
    hosts: ["planetarycomputer.microsoft.com", "landsateuwest.blob.core.windows.net"],
    provides: "Ground temperature from the latest cloud-free Landsat scene",
    licence: "US government data, public domain",
    attribution: "Landsat data from the US Geological Survey",
  },
  {
    id: "portals",
    name: "Open-data portals",
    hosts: [],
    provides: "Datasets of the portals in the starter list and the ones you add (CKAN, Socrata, ArcGIS Hub)",
    licence: "Each dataset's own licence",
    attribution: "As each dataset asks",
  },
];

export const OPEN_DATA_SOURCE_IDS = OPEN_DATA_SOURCES.map((s) => s.id);

/** The portals the app lists before the user adds any: large public catalogues, each on a known platform. */
export const STARTER_PORTALS: ReadonlyArray<{ host: string; kind: "ckan" | "socrata" | "arcgis-hub" }> = [
  { host: "ckan.publishing.service.gov.uk", kind: "ckan" },
  { host: "ckan.opendata.swiss", kind: "ckan" },
  { host: "data.cityofnewyork.us", kind: "socrata" },
  { host: "data.sf.gov", kind: "socrata" },
  { host: "data.cityofchicago.org", kind: "socrata" },
  { host: "data.lacity.org", kind: "socrata" },
  { host: "data.seattle.gov", kind: "socrata" },
  { host: "hub.arcgis.com", kind: "arcgis-hub" },
];

/** What one request is allowed to cost: the time, and the size of what comes back, by kind of answer. */
export const OPEN_DATA_LIMITS = {
  timeoutMs: 10_000,
  /** The most a request may ask for as its own time limit (a public server answering a large query slowly). */
  maxTimeoutMs: 60_000,
  maxRedirects: 3,
  /** Text and JSON answers. */
  maxJsonBytes: 2 * 1024 * 1024,
  /** A window of a raster. */
  maxRasterBytes: 20 * 1024 * 1024,
} as const;

/** One request the app made, for the list in Settings. */
export const OpenDataRecordEntry = z.strictObject({
  /** Epoch milliseconds. */
  at: z.number(),
  source: z.string(),
  host: z.string(),
  /** What it was for: "weather", "buildings", a portal search... */
  kind: z.string(),
  cached: z.boolean(),
  bytes: z.number().int().nonnegative(),
  /** Set when it failed: why, in a few words. */
  error: z.string().optional(),
});
export type OpenDataRecordEntry = z.infer<typeof OpenDataRecordEntry>;

/** A host name as the user types it for a portal: no scheme, no path, lower case. */
export const PortalHost = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/,
    "A host name such as data.example.org",
  );
